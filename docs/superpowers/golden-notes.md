# Golden check notes

Source of truth for the thresholds is design section 9. Figures below are percentages and
pattern descriptions only; no amounts, names or identifiers.

## 1. `pnpm golden:classify` (classifier vs the report grouping)

Run on the full owner CSV (3,396 rows, 2025-2026, black and white cards, no fop rows).

| Report group | Match by amount |
|---|---|
| Overall | 98.75% (threshold 95%) |
| Доход | 100.00% |
| Расходы | 100.00% |
| Займы | 100.00% |
| Переводы | 99.92% |
| Свои счета | 96.90% |
| Долги | 94.40% |

Without the context derived from the report's own-account rows (own names, own jar titles)
the overall match is 98.04%, so the result does not hinge on that derivation.

The type mapping is the table from the plan, made one step stricter: `own_transfer` is accepted
under "Доход" only for the report category "С ФОП-счёта", and `spend` under "Доход" only for
positive amounts (refunds).

### Where the classifier and the report disagree

All remaining disagreements are about 1.25% of the weighted amount, in four classes:

1. **Bank installment-service payments, "Платіж <store>" with MCC 4829** (about 0.9%).
   The report files most of them under purchases ("Покупки") and a few under installments
   ("Долги"), with identical texts. The classifier calls all of them `spend`/shopping, so the
   few filed under debts disagree. The texts cannot tell the two apart; a scheduled-payment
   match or an owner rule is the only way to separate them.
2. **"Переказ на картку" with no matching leg** (about 0.4%). When the opposite row on another
   own card is in the data, the pair is detected and the row is `own_transfer`. Six rows the
   report files as transfers between own cards have no counterpart in the file (the other side
   is outside black and white, or the times differ by more than 10 minutes), so they fall back
   to `person_transfer` with `needsLabel`.
3. **Penalty for late repayment** (tiny). The report calls it a transfer; the classifier calls
   it `debt_payment`, which is the better label.
4. **Account-migration entries** (tiny). Both directions are `own_transfer`; the report has one
   as a transfer to people and one as other income.

## 2. Totals by report group, classifier types summed with report definitions

With the report's definitions applied (taxes and cash withdrawals in consumption, cash deposits,
transfers from people and fop withdrawals in income), the classifier's totals sit within these
distances of the report's own group totals:

- Доход and Займы: within 0.01%.
- Переводы: about 3% higher, from penalties and unmatched card transfers filed there by the
  classifier.
- Расходы: about 4% higher and Долги about 5% lower, almost entirely the "Платіж <store>"
  class in item 1 above.

## 3. `pnpm golden:import` (API import vs the report totals)

Not run. It needs a database filled by the real monobank import, which needs the owner's token
(owner gate). The script and its mapping/summing are unit-tested on a small fixture.

To run: import 2026 history, let the reclassify job finish, put the five expected totals in the
git-ignored `private/golden-expected.json` (format in the script header), then
`DATABASE_URL=... pnpm golden:import`. Expected explainable differences once it runs:

- Rows still `hold` are skipped; rows with no UAH amount (missing rate) are skipped.
- `id` values differ from the PDF export, and the PDF-based report may miss or double-count a
  few rows near the period edges (design section 9).
- Own-account detection relies on the paired-leg rule and on text; transfers whose other leg is
  outside black and white, or an owner name not set in `OWNER_NAMES`, land in `person_transfer`
  / `person_in` and move the totals for "Переводы" and "Доход".
- fop rows are absent from the report's cards but a fop account in the API is excluded by the
  query (black and white only).
