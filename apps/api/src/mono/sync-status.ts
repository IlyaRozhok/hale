import type { DataSource } from "typeorm";

/** Records a successful webhook item or reconcile; the app reads it to show `syncStale`. */
export async function markSynced(ds: DataSource, at: Date): Promise<void> {
  await ds.query(`UPDATE settings SET last_sync_at=$1 WHERE id=1`, [at]);
}
