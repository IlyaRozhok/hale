/**
 * SQL for the stable, opaque id of a counterparty: a hash of counter_iban, else of the
 * normalised counter_name, else of the normalised description. Used by the transactions API
 * and by the questions on /today, so both name the same person the same way.
 */
export const normalisedText = (col: string): string => `lower(btrim(regexp_replace(${col}, '\\s+', ' ', 'g')))`;

export const counterKeySql = (t = "t"): string =>
  `substr(md5(CASE WHEN NULLIF(${t}.counter_iban,'') IS NOT NULL THEN 'iban:' || ${t}.counter_iban ` +
  `ELSE 'name:' || ${normalisedText(`COALESCE(NULLIF(${t}.counter_name,''), ${t}.description)`)} END), 1, 16)`;
