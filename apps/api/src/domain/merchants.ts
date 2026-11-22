/**
 * Bank texts and public merchant-chain patterns used by classify(). Nothing here names a
 * person; transfer recipients are never matched by name.
 */

export type Category =
  | "groceries"
  | "cafe"
  | "transport"
  | "subscriptions"
  | "leisure"
  | "health"
  | "utilities"
  | "telecom"
  | "shopping"
  | "uncategorized"
  | "tax"
  | "debt"
  | "loan"
  | "cash"
  | "transfer"
  | "own"
  | "income"
  | "refund";

export const TRANSFER_MCCS: ReadonlySet<number> = new Set([4829, 6012]);
export const CASH_MCCS: ReadonlySet<number> = new Set([6010, 6011]);

/** Chains whose MCC is unreliable or missing; checked before the MCC table. */
export const MERCHANTS: readonly { pattern: RegExp; category: Category }[] = [
  // Б55: food delivery from a taxi brand, before the taxi: «Bolt Food» and «Uber Eats» contain «bolt» and «uber».
  // The name wins over the MCC too, so a delivery that comes with a taxi MCC (4121) is still a cafe.
  { pattern: /\b(bolt\s+food|uber\s+eats)\b/i, category: "cafe" },
  { pattern: /\b(uklon|bolt|uber|taxi|таксі)\b/i, category: "transport" },
  { pattern: /(нова пошта|nova poshta|укрпошта|ukrposhta)/i, category: "shopping" },
  { pattern: /(сільпо|silpo|(?<![\p{L}])атб(?![\p{L}])|\batb\b|varus|варус|novus|новус|ekomarket|ашан|auchan)/iu, category: "groceries" },
  { pattern: /(glovo|wolt|mcdonald|kfc|sushiya|aroma kava)/i, category: "cafe" },
  { pattern: /(lifecell|vodafone|київстар|kyivstar|tenet|datagroup|volia)/i, category: "telecom" },
  { pattern: /(netflix|spotify|youtube|apple\.com|google|icloud|megogo|nvidia|openai|anthropic|github|notion)/i, category: "subscriptions" },
  { pattern: /(аптека|apteka|подорожник|фармація)/i, category: "health" },
  { pattern: /(rozetka|розетка|епіцентр|epicentr|comfy|foxtrot|фокстрот|citrus|цитрус)/i, category: "shopping" },
  // Б14: a cafe often comes with a grocery MCC (5499); the word in its name wins over the code.
  // Last, so a known chain above keeps its category even with «кафе» or «бар» in its name.
  // JS \b is ASCII-only, so Cyrillic word edges use lookarounds.
  { pattern: /(?<!\p{L})(кафе|ресторан|суши|суші|бар|cafe|café|restaurant|sushi|bar)(?!\p{L})/iu, category: "cafe" },
];

/** MCC to category, exact codes first, then ranges. */
export function categoryByMcc(mcc: number | null): Category {
  if (mcc === null) return "uncategorized";
  if (mcc === 5411 || mcc === 5499 || mcc === 5422 || mcc === 5441 || mcc === 5451 || mcc === 5462) return "groceries";
  if (mcc >= 5811 && mcc <= 5814) return "cafe";
  if (mcc === 4121 || mcc === 4111 || mcc === 4131 || mcc === 4789 || mcc === 4112 || mcc === 4011) return "transport";
  // Б15: 5816 is games (Steam, PlayStation): leisure, not a subscription.
  if (mcc === 5816) return "leisure";
  if ((mcc >= 5815 && mcc <= 5818) || mcc === 5734 || mcc === 5968 || mcc === 7372 || mcc === 5192) return "subscriptions";
  if (mcc === 4814 || mcc === 4816 || mcc === 4899) return "telecom";
  if (mcc === 4900) return "utilities";
  if (mcc === 5912 || mcc === 5977 || mcc === 5122 || (mcc >= 8011 && mcc <= 8099)) return "health";
  if (mcc === 7997 || mcc === 7999 || mcc === 7832 || mcc === 7922 || mcc === 7011 || mcc === 7941 || mcc === 7841) return "leisure";
  if ((mcc >= 5200 && mcc <= 5999) || mcc === 4215 || mcc === 7361 || mcc === 7311 || mcc === 7375 || mcc === 4812) return "shopping";
  return "uncategorized";
}

/** Purchase MCCs: anything that is not a money-movement or cash code. */
export const isPurchaseMcc = (mcc: number | null): boolean =>
  mcc !== null && !TRANSFER_MCCS.has(mcc) && !CASH_MCCS.has(mcc);

export function categoryByMerchant(description: string): Category | null {
  for (const m of MERCHANTS) if (m.pattern.test(description)) return m.category;
  return null;
}
