import { Inject, Injectable, Logger } from "@nestjs/common";
import { DataSource } from "typeorm";
import { kyivDate } from "../domain/money";
import { type AccountStatement, type HoldCounters, type HoldRow, checkHolds } from "./hold-check";
import { SPLIT_THRESHOLD } from "./import.service";
import { JOB_CLOCK, type JobClock } from "./jobs/job-runner";
import { MonoClient } from "./mono.client";
import { kyivMidnight } from "./mono.controller";
import type { MonoStatementItem } from "./mono.schemas";
import { planWindows, splitWindow, type Window } from "./windows";

/**
 * Task Б6, step 2: the one-off hold check (docs/superpowers/b6-hold-check.md, sections 3 and 5).
 * Runs inside the API process through the shared MonoClient (one request a minute), reads
 * `accounts` and `transactions`, writes nothing, and keeps its result in memory only.
 */

export interface HoldCheckResult extends HoldCounters {
  /** Kyiv dates; statements were read from the day before `from`. */
  period: { from: string; to: string };
  /** Accounts and jars checked (everything but cash). */
  accounts: number;
  /** Planned grows by two on every split, so split + read + unread = planned. */
  windowsPlanned: number;
  windowsSplit: number;
  windowsRead: number;
  windowsUnread: number;
  /** Hold rows before the period: not checked, only counted. */
  holdsBeforePeriod: number;
}

export type HoldCheckState =
  | { status: "idle" }
  | { status: "running"; windowsPlanned: number; windowsRead: number }
  | { status: "done"; result: HoldCheckResult }
  /** One word, never an error text: a bank error embeds the request path with the account id. */
  | { status: "failed"; reason: "database" | "internal" };

interface Progress {
  windowsPlanned: number;
  windowsSplit: number;
  windowsRead: number;
  windowsUnread: number;
}

/** Kyiv midnight of the Kyiv day before the one that holds `at`. */
function kyivDayBefore(at: Date): Date {
  const [y, m, d] = kyivDate(at).split("-").map(Number) as [number, number, number];
  const prev = new Date(Date.UTC(y, m - 1, d) - 86_400_000);
  const ymd = prev.toISOString().slice(0, 10);
  return kyivMidnight(ymd) ?? new Date(at.getTime() - 86_400_000);
}

@Injectable()
export class HoldCheckService {
  private readonly log = new Logger(HoldCheckService.name);
  private current: HoldCheckState = { status: "idle" };
  private progress: Progress | undefined;
  private run: Promise<void> = Promise.resolve();

  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(MonoClient) private readonly client: MonoClient,
    @Inject(JOB_CLOCK) private readonly clock: JobClock,
  ) {}

  state(): HoldCheckState {
    if (this.current.status === "running" && this.progress) {
      return { status: "running", windowsPlanned: this.progress.windowsPlanned, windowsRead: this.progress.windowsRead };
    }
    return this.current;
  }

  /**
   * Starts the check in the background unless one is running or has finished with a result in
   * this process: the owner's consent is for one look. After `failed` nothing was seen, so it may run again.
   */
  start(from: Date): { started: boolean; state: HoldCheckState } {
    if (this.current.status === "running" || this.current.status === "done") {
      return { started: false, state: this.state() };
    }
    this.progress = { windowsPlanned: 0, windowsSplit: 0, windowsRead: 0, windowsUnread: 0 };
    this.current = { status: "running", windowsPlanned: 0, windowsRead: 0 };
    this.run = this.execute(from);
    return { started: true, state: this.state() };
  }

  /** Resolves when the current run has finished (never rejects). */
  settled(): Promise<void> {
    return this.run;
  }

  private async execute(from: Date): Promise<void> {
    const progress = this.progress!;
    try {
      const now = new Date(this.clock.now());
      const fromSec = Math.floor(from.getTime() / 1000);
      const statementFromSec = Math.floor(kyivDayBefore(from).getTime() / 1000);
      const toSec = Math.floor(now.getTime() / 1000);

      let accounts: string[];
      let holds: HoldRow[];
      let holdIds: string[];
      let holdsBeforePeriod: number;
      try {
        ({ accounts, holds, holdIds, holdsBeforePeriod } = await this.read(from));
      } catch (e) {
        this.fail("database", e);
        return;
      }

      const plans = accounts.map((account) => ({ account, windows: planWindows(statementFromSec, toSec) }));
      progress.windowsPlanned = plans.reduce((n, p) => n + p.windows.length, 0);

      const statements: AccountStatement[] = [];
      for (const plan of plans) statements.push(await this.readAccount(plan.account, plan.windows, progress));

      const counters = checkHolds({ from: fromSec, holds, holdIds, statements });
      this.current = {
        status: "done",
        result: {
          ...counters,
          period: { from: kyivDate(from), to: kyivDate(now) },
          accounts: accounts.length,
          windowsPlanned: progress.windowsPlanned,
          windowsSplit: progress.windowsSplit,
          windowsRead: progress.windowsRead,
          windowsUnread: progress.windowsUnread,
          holdsBeforePeriod,
        },
      };
      this.log.log(
        `hold check done: ${accounts.length} account(s), ${progress.windowsRead} window(s) read, ${progress.windowsUnread} unread`,
      );
    } catch (e) {
      this.fail("internal", e);
    } finally {
      this.progress = undefined;
    }
  }

  /** Only the reason word and the error's class name reach the log: never its text. */
  private fail(reason: "database" | "internal", e: unknown): void {
    this.current = { status: "failed", reason };
    this.log.warn(`hold check failed: ${reason} (${e instanceof Error ? e.name : typeof e})`);
  }

  private async read(from: Date) {
    const accountRows: { external_id: string }[] = await this.ds.query(
      `SELECT external_id FROM accounts WHERE kind <> 'cash' ORDER BY id`,
    );
    const holdRows: { id: string; account: string; time: string; amount: string; mcc: number | null; description: string }[] =
      await this.ds.query(
        `SELECT t.external_id AS id, a.external_id AS account, extract(epoch FROM t.occurred_at)::bigint AS time,
                t.amount, t.mcc, t.description
           FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE t.hold AND a.kind <> 'cash' AND t.occurred_at >= $1
          ORDER BY t.occurred_at, t.id`,
        [from],
      );
    const idRows: { external_id: string }[] = await this.ds.query(`SELECT external_id FROM transactions WHERE hold`);
    const before: { n: number }[] = await this.ds.query(
      `SELECT count(*)::int AS n FROM transactions WHERE hold AND occurred_at < $1`,
      [from],
    );
    return {
      accounts: accountRows.map((r) => r.external_id),
      holds: holdRows.map((r) => ({
        id: r.id,
        account: r.account,
        time: Number(r.time),
        amount: Number(r.amount),
        mcc: r.mcc,
        description: r.description,
      })),
      holdIds: idRows.map((r) => r.external_id),
      holdsBeforePeriod: before[0]?.n ?? 0,
    };
  }

  /**
   * Reads the account's windows in order. A response of SPLIT_THRESHOLD rows or more is halved and both
   * halves are fetched; a window is unread only when it cannot be split further or the retry failed too.
   */
  private async readAccount(account: string, windows: Window[], progress: Progress): Promise<AccountStatement> {
    const queue: Window[] = [...windows];
    const rows: MonoStatementItem[] = [];
    let unread = false;
    while (queue.length > 0) {
      const [from, to] = queue.shift()!;
      const items = await this.fetchWithRetry(account, from, to);
      if (!items) {
        unread = true;
        progress.windowsUnread += 1;
        continue;
      }
      if (items.length >= SPLIT_THRESHOLD) {
        const halves = splitWindow(from, to);
        if (halves) {
          progress.windowsSplit += 1;
          progress.windowsPlanned += 2;
          queue.unshift(...halves);
          continue;
        }
        // A single second that may still be truncated: what came is kept, the window counts as unread.
        unread = true;
        progress.windowsUnread += 1;
        rows.push(...items);
        continue;
      }
      progress.windowsRead += 1;
      rows.push(...items);
    }
    return { account, rows, unread };
  }

  /** One retry; undefined when both attempts failed. Nothing of the error is kept. */
  private async fetchWithRetry(account: string, from: number, to: number): Promise<MonoStatementItem[] | undefined> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.client.statement(account, from, to);
      } catch {
        // Retried once below; the error text may embed the account id, so it is not logged.
      }
    }
    return undefined;
  }
}
