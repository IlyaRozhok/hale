import { UNCATEGORIZED } from "./insights";

/**
 * The category to store for one the classifier gave (В5). The classifier knows only the default keys; one the owner
 * has deleted is filed as «Без категории», where that category's rows went. Keys of other types (tax, transfer, …)
 * are not in the list and are never deleted, so they pass as they are.
 */
export const storedCategory = (category: string, deleted: ReadonlySet<string>): string =>
  deleted.has(category) ? UNCATEGORIZED : category;
