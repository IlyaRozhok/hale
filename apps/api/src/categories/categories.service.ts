import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import type { CategoryDeletedDto, CategoryDto, CategoryInput, CategoryPatch } from "@hale/contracts";
import { randomBytes } from "node:crypto";
import { DataSource, type EntityManager } from "typeorm";
import { UNCATEGORIZED } from "../domain/insights";

const COLUMNS = `key, name, icon, system, want`;

/**
 * Task В5: the owner's spending categories. Only names, icons, order and (В6) the side, «нужное» or «желаемое»,
 * change here; nothing about money does — a category does not count in the limit, «потрачено» or the plan.
 */
@Injectable()
export class CategoriesService {
  constructor(@Inject(DataSource) private readonly ds: DataSource) {}

  async list(q: DataSource | EntityManager = this.ds): Promise<CategoryDto[]> {
    return q.query(`SELECT ${COLUMNS} FROM categories WHERE deleted_at IS NULL ORDER BY position, id`);
  }

  /**
   * At the end of the list, with a key of its own: never made from the name, so a rename does not change it.
   * «Нужное» unless the owner chose «желаемое» (В6).
   */
  async create(p: CategoryInput): Promise<CategoryDto> {
    return this.ds.transaction(async (m) => {
      await this.lock(m);
      await this.nameFree(m, p.name, null);
      const rows: CategoryDto[] = await m.query(
        `INSERT INTO categories (key, name, icon, position, want)
         SELECT $1, $2, $3, COALESCE(max(position) + 1, 0), $4 FROM categories WHERE deleted_at IS NULL
         RETURNING ${COLUMNS}`,
        [`c_${randomBytes(6).toString("hex")}`, p.name, p.icon, p.want ?? false],
      );
      return rows[0]!;
    });
  }

  async change(key: string, p: CategoryPatch): Promise<CategoryDto> {
    return this.ds.transaction(async (m) => {
      await this.lock(m);
      const row = await this.live(m, key);
      if (p.name !== undefined) {
        if (row.system) throw new UnprocessableEntityException("a system category keeps its name");
        await this.nameFree(m, p.name, key);
      }
      // A system category is on neither side (В6). The operations' own choices stay as they are.
      if (p.want !== undefined && row.system) throw new UnprocessableEntityException("a system category has no side");
      const [rows] = (await m.query(
        `UPDATE categories SET name = COALESCE($2, name), icon = COALESCE($3, icon), want = COALESCE($4, want)
          WHERE key = $1 RETURNING ${COLUMNS}`,
        [key, p.name ?? null, p.icon ?? null, p.want ?? null],
      )) as [CategoryDto[], number];
      return rows[0]!;
    });
  }

  /** `keys`: every live category exactly once, in the new order. */
  async reorder(keys: readonly string[]): Promise<CategoryDto[]> {
    return this.ds.transaction(async (m) => {
      const live: { key: string }[] = await m.query(`SELECT key FROM categories WHERE deleted_at IS NULL FOR UPDATE`);
      const given = new Set(keys);
      if (given.size !== keys.length || keys.length !== live.length || !live.every((c) => given.has(c.key))) {
        throw new UnprocessableEntityException("keys: every category exactly once");
      }
      await m.query(
        `UPDATE categories c SET position = o.n - 1 FROM unnest($1::text[]) WITH ORDINALITY AS o(key, n) WHERE c.key = o.key`,
        [keys],
      );
      return this.list(m);
    });
  }

  /**
   * In one transaction: the category's operations (cash ones are rows of the wallet's account), its rules and the
   * rows answers would give back go to «Без категории», and the category is marked deleted. Its key stays taken,
   * so a deleted default category never comes back.
   */
  async remove(key: string): Promise<CategoryDeletedDto> {
    return this.ds.transaction(async (m) => {
      const row = await this.live(m, key);
      if (row.system) throw new UnprocessableEntityException("a system category is not deleted");
      const [, moved] = (await m.query(`UPDATE transactions SET category = $2 WHERE category = $1`, [key, UNCATEGORIZED])) as [unknown, number];
      await m.query(`UPDATE rules SET category = $2 WHERE category = $1`, [key, UNCATEGORIZED]);
      await m.query(`UPDATE cash_answers SET category_before = $2 WHERE category_before = $1`, [key, UNCATEGORIZED]);
      await m.query(`UPDATE categories SET deleted_at = now() WHERE key = $1`, [key]);
      return { deleted: true, moved };
    });
  }

  /** One change of names or places at a time: two at once could give one name twice or one place twice. */
  private async lock(m: EntityManager): Promise<void> {
    await m.query(`LOCK TABLE categories IN SHARE ROW EXCLUSIVE MODE`);
  }

  /** 409 when another live category (not `self`) has the name, ignoring case. */
  private async nameFree(m: EntityManager, name: string, self: string | null): Promise<void> {
    const live: { key: string; name: string }[] = await m.query(`SELECT key, name FROM categories WHERE deleted_at IS NULL`);
    const folded = name.toLowerCase();
    if (live.some((c) => c.key !== self && c.name.toLowerCase() === folded)) {
      throw new ConflictException("name: another category has this name");
    }
  }

  /** The live category, locked for the change; 404 for an unknown or deleted one. */
  private async live(m: EntityManager, key: string): Promise<{ system: boolean }> {
    const rows: { system: boolean }[] = await m.query(
      `SELECT system FROM categories WHERE key = $1 AND deleted_at IS NULL FOR UPDATE`,
      [key],
    );
    if (!rows[0]) throw new NotFoundException("category not found");
    return rows[0];
  }
}
