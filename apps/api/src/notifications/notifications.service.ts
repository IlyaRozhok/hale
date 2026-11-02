import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { DataSource } from "typeorm";
import { addDays, kyivDate } from "../domain/money";
import { Clock } from "../today/clock";
import { TodayService } from "../today/today.service";
import { ExpoPush } from "./expo-push";
import { dueNotifications, type Notification, type NotifyState } from "./schedule";

const LOAN_ALERT_DAYS = 2;

/** Sends the notifications that `dueNotifications` says are due; logs a key only after a device accepted it. */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);
  private ticking = false;

  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(Clock) private readonly clock: Clock,
    @Inject(TodayService) private readonly today: TodayService,
    @Inject(ExpoPush) private readonly push: ExpoPush,
  ) {}

  @Cron("*/15 * * * *", { timeZone: "Europe/Kyiv" })
  async cron(): Promise<void> {
    try {
      await this.tick();
    } catch (e) {
      this.log.warn(`notification tick failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** One pass: works out what is due now and sends it. Returns the keys that were delivered. */
  async tick(): Promise<string[]> {
    if (this.ticking) return [];
    this.ticking = true;
    try {
      const now = this.clock.now();
      const due = dueNotifications(await this.loadState(now), now);
      const delivered: string[] = [];
      let ordinaryDone = false;
      for (const n of due) {
        // Tax reminders all go out; of the ordinary candidates, stop at the first that gets through.
        if (n.kind !== "tax" && ordinaryDone) continue;
        if (await this.deliver(n, now)) {
          delivered.push(n.key);
          if (n.kind !== "tax") ordinaryDone = true;
        }
      }
      return delivered;
    } finally {
      this.ticking = false;
    }
  }

  private async loadState(now: Date): Promise<NotifyState> {
    const date = kyivDate(now);
    const t = await this.today.getToday();
    const taxes: { id: number; name: string; amount: number; currency: string; due_on: string }[] = await this.ds.query(
      `SELECT id, name, amount::float8 AS amount, currency, due_on::text AS due_on
         FROM scheduled_payments WHERE kind='tax' AND paid_at IS NULL AND due_on BETWEEN $1 AND $2 ORDER BY due_on, id`,
      [addDays(date, -1), addDays(date, 7)],
    );
    // A loan alert is only for a loan taken in the last two days; older open loans stay on the screen only.
    const recent: { id: number }[] = await this.ds.query(`SELECT id FROM loans WHERE received_on >= $1::date`, [
      addDays(date, -LOAN_ALERT_DAYS),
    ]);
    const recentIds = new Set(recent.map((l) => `loan:${l.id}`));
    const badCases = t.badCases.filter((b) => !b.id.startsWith("loan:") || recentIds.has(b.id));
    const keys: { key: string }[] = await this.ds.query(`SELECT key FROM notifications_log`);
    const ordinary = await this.ds.query(
      `SELECT 1 FROM notifications_log WHERE kind <> 'tax' AND (sent_at AT TIME ZONE 'Europe/Kyiv')::date = $1::date LIMIT 1`,
      [date],
    );
    return {
      taxes: taxes.map((p) => ({ id: p.id, name: p.name, amount: p.amount, currency: p.currency, dueOn: p.due_on, paid: false })),
      leftToday: t.state.leftToday,
      dailyLimit: t.state.dailyLimit,
      badCases,
      questions: t.questions,
      syncedAt: t.syncedAt,
      sentKeys: new Set(keys.map((k) => k.key)),
      ordinarySentToday: ordinary.length > 0,
    };
  }

  /** True when at least one device accepted it; only then is the key logged. No devices: nothing is logged. */
  private async deliver(n: Notification, now: Date): Promise<boolean> {
    const devices: { id: number; push_token: string }[] = await this.ds.query(
      `SELECT id, push_token FROM devices WHERE push_token IS NOT NULL ORDER BY id`,
    );
    if (devices.length === 0) return false;
    const results = await this.push.send(
      devices.map((d) => d.push_token),
      n,
    );
    const dead = results.filter((r) => r.deviceNotRegistered).map((r) => r.token);
    if (dead.length > 0) await this.ds.query(`UPDATE devices SET push_token=NULL WHERE push_token = ANY($1)`, [dead]);
    if (!results.some((r) => r.ok)) {
      this.log.warn(`${n.key} not delivered: ${results.map((r) => r.error).filter(Boolean).join("; ")}`);
      return false;
    }
    await this.ds.query(`INSERT INTO notifications_log (key, kind, sent_at) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING`, [
      n.key, n.kind, now,
    ]);
    return true;
  }
}
