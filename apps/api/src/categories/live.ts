import { BadRequestException } from "@nestjs/common";
import type { DataSource, EntityManager } from "typeorm";

/**
 * Refuses (400) a category that is not a live one: unknown, or deleted by the owner (В5). Called inside the
 * transaction that writes it: the row is locked for share, so a delete running at the same time waits for it
 * and then moves this row too.
 */
export async function requireLiveCategory(m: EntityManager, key: string): Promise<void> {
  const rows: unknown[] = await m.query(`SELECT 1 FROM categories WHERE key = $1 AND deleted_at IS NULL FOR SHARE`, [key]);
  if (rows.length === 0) throw new BadRequestException("category: no such category");
}

/**
 * The keys the owner deleted. A database migrated only up to before 0035 has no table, and nothing deleted:
 * only the migration tests run the classifier on one.
 */
export async function deletedCategories(q: DataSource | EntityManager): Promise<Set<string>> {
  const [table] = (await q.query(`SELECT to_regclass('public.categories') IS NOT NULL AS ok`)) as { ok: boolean }[];
  if (!table?.ok) return new Set();
  const rows: { key: string }[] = await q.query(`SELECT key FROM categories WHERE deleted_at IS NOT NULL`);
  return new Set(rows.map((r) => r.key));
}
