import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import type { Job } from "../../db/entities";
import { MonoApiError } from "../mono.errors";

export const MAX_ATTEMPTS = 5;
export const JOB_TICK_MS = 10_000;
const RETRY_BASE_MS = 60_000;
const DEFAULT_RETRY_AFTER_S = 60;

/** True when this failure ends the job for good: a rate limit never does, it costs no attempt. */
export function isFinalFailure(job: Pick<Job, "attempts">, e: unknown): boolean {
  return !(e instanceof MonoApiError && e.status === 429) && job.attempts + 1 >= MAX_ATTEMPTS;
}

export type JobHandler = (job: Job) => Promise<void>;
export interface JobClock {
  now(): number;
}
export const JOB_CLOCK = Symbol("JOB_CLOCK");

/**
 * Postgres-backed queue. It only claims `pending` rows whose kind has a registered handler,
 * so rows written by other tools (e.g. `backup.failed`) are never touched.
 */
@Injectable()
export class JobRunner implements OnApplicationBootstrap {
  private readonly log = new Logger(JobRunner.name);
  private readonly handlers = new Map<string, JobHandler>();
  private ticking = false;

  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(JOB_CLOCK) private readonly clock: JobClock = { now: () => Date.now() },
  ) {}

  register(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.recoverInterrupted();
  }

  /** Jobs left `running` by a crashed process go back to the queue. */
  async recoverInterrupted(): Promise<void> {
    const kinds = [...this.handlers.keys()];
    if (kinds.length === 0) return;
    await this.ds.query(
      `UPDATE jobs SET status='pending' WHERE status='running' AND kind = ANY($1)`,
      [kinds],
    );
  }

  @Interval(JOB_TICK_MS)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      while (await this.runOnce());
    } catch (e) {
      this.log.error(e instanceof Error ? e.message : String(e));
    } finally {
      this.ticking = false;
    }
  }

  /** Claims and runs one due job. Returns false when nothing was due. */
  async runOnce(): Promise<boolean> {
    const kinds = [...this.handlers.keys()];
    if (kinds.length === 0) return false;
    const job = await this.claim(kinds);
    if (!job) return false;
    try {
      await this.handlers.get(job.kind)!(job);
      await this.ds.query(`UPDATE jobs SET status='done', last_error=NULL WHERE id=$1`, [job.id]);
    } catch (e) {
      await this.handleFailure(job, e);
    }
    return true;
  }

  private async claim(kinds: string[]): Promise<Job | undefined> {
    return this.ds.transaction(async (m) => {
      const rows: Job[] = await m.query(
        `SELECT * FROM jobs
          WHERE status='pending' AND kind = ANY($1) AND run_after <= $2
          ORDER BY run_after, id LIMIT 1
          FOR UPDATE SKIP LOCKED`,
        [kinds, new Date(this.clock.now())],
      );
      const job = rows[0];
      if (!job) return undefined;
      await m.query(`UPDATE jobs SET status='running' WHERE id=$1`, [job.id]);
      return job;
    });
  }

  private async handleFailure(job: Job, e: unknown): Promise<void> {
    const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    const now = this.clock.now();
    if (e instanceof MonoApiError && e.status === 429) {
      // Rate limited: wait as told; this is not the window's fault, so no attempt is spent.
      const delayMs = (e.retryAfter ?? DEFAULT_RETRY_AFTER_S) * 1000;
      await this.ds.query(
        `UPDATE jobs SET status='pending', run_after=$2, last_error=$3 WHERE id=$1`,
        [job.id, new Date(now + delayMs), message],
      );
      return;
    }
    const attempts = job.attempts + 1;
    if (isFinalFailure(job, e)) {
      this.log.warn(`job ${job.id} (${job.kind}) failed permanently: ${message}`);
      await this.ds.query(
        `UPDATE jobs SET status='failed', attempts=$2, last_error=$3 WHERE id=$1`,
        [job.id, attempts, message],
      );
      return;
    }
    await this.ds.query(
      `UPDATE jobs SET status='pending', attempts=$2, run_after=$3, last_error=$4 WHERE id=$1`,
      [job.id, attempts, new Date(now + RETRY_BASE_MS * attempts), message],
    );
  }
}
