import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  type AccountDto,
  type ExpectedIncomeDto,
  type GoalDto,
  accountPatch,
  confirmIncomeInput,
  expectedIncomeInput,
  expectedIncomePatch,
  goalInput,
  goalPatch,
  incomeDateInput,
  installmentInput,
  installmentPatch,
  loanInput,
  loanPatch,
  loanRepayInput,
  manualBalanceInput,
  manualBalancePatch,
  matchTransactionInput,
  recurringInput,
  recurringPatch,
  scheduledPaymentInput,
  scheduledPaymentPatch,
  settingsPatch,
} from "@hale/contracts";
import { DataSource, type ObjectLiteral, type Repository } from "typeorm";
import type { z } from "zod";
import { ExpectedIncome, Goal, Loan, ManualBalance, RecurringPayment, ScheduledPayment, Settings } from "../db/entities";
import { type IncomeRow, changedIncome, incomeDto, incomeProblem, newIncome } from "../domain/incomes";
import { type AccountKind, countsAsOwn } from "../domain/ledger";
import { LimitService } from "../today/limit.service";
import { type BankAccountKind, accountName } from "../today/today.service";
import { goalDtos, goalPlaceColumns, goalPlaceCurrency } from "./goals";
import { LoansService } from "./loans.service";
import { PlanEntriesService } from "./plan-entries.service";
import { PlanService } from "./plan.service";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return r.data;
}

async function patchRow<T extends ObjectLiteral & { id: number }>(repo: Repository<T>, id: number, data: object): Promise<T> {
  if (Object.keys(data).length > 0) await repo.update(id, data as never);
  const row = await repo.findOneBy({ id } as never);
  if (!row) throw new NotFoundException();
  return row;
}

async function removeRow<T extends ObjectLiteral>(repo: Repository<T>, id: number): Promise<{ deleted: true }> {
  const r = await repo.delete(id);
  if (!r.affected) throw new NotFoundException();
  return { deleted: true };
}

const badCase = (l: Loan) => ({ ...l, bad_case: l.repaid_at === null });

@Controller("plan")
export class PlanController {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(PlanService) private readonly plan: PlanService,
    @Inject(LoansService) private readonly loans: LoansService,
    @Inject(PlanEntriesService) private readonly entries: PlanEntriesService,
    @Inject(LimitService) private readonly limit: LimitService,
  ) {}

  // --- expected incomes -----------------------------------------------------
  @Get("expected-incomes")
  async listExpected(): Promise<ExpectedIncomeDto[]> {
    return (await this.ds.getRepository(ExpectedIncome).find({ order: { id: "ASC" } })).map(incomeDto);
  }

  /** A new income (Д3а): by its name, schedule, account and flags, or by its old kind alone, as an older app sends it. */
  @Post("expected-incomes")
  async createExpected(@Body() body: unknown): Promise<ExpectedIncomeDto> {
    const income = newIncome(parse(expectedIncomeInput, body));
    await this.checkIncome(income);
    const repo = this.ds.getRepository(ExpectedIncome);
    const row = await repo.save(repo.create(income));
    await this.entries.generated();
    return incomeDto(row);
  }

  @Patch("expected-incomes/:id")
  async patchExpected(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<ExpectedIncomeDto> {
    const data = parse(expectedIncomePatch, body);
    const cur = await this.ds.getRepository(ExpectedIncome).findOneBy({ id });
    if (!cur) throw new NotFoundException();
    const next = changedIncome(cur, data);
    await this.checkIncome(next);
    return incomeDto(await this.entries.patchExpected(id, cur, next));
  }

  /** Refuses an income that is wrong as a whole, or one that names an account that is not there. */
  private async checkIncome(i: IncomeRow): Promise<void> {
    const problem = incomeProblem(i);
    if (problem) throw new BadRequestException(problem);
    const missing = async (table: "accounts" | "manual_balances", id: number | null) =>
      id !== null && (await this.ds.query(`SELECT 1 FROM ${table} WHERE id=$1`, [id])).length === 0;
    if ((await missing("accounts", i.account_id)) || (await missing("manual_balances", i.manual_balance_id))) {
      throw new BadRequestException("account not found");
    }
  }

  @Delete("expected-incomes/:id")
  async deleteExpected(@Param("id", ParseIntPipe) id: number): Promise<{ deleted: true }> {
    const done = await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM income_events WHERE expected_income_id=$1`, [id]);
      return removeRow(m.getRepository(ExpectedIncome), id);
    });
    await this.entries.freshLimit();
    return done;
  }

  // --- income events --------------------------------------------------------
  @Get("incomes")
  listEvents() {
    return this.plan.listEvents();
  }

  @Post("incomes/:eventId/confirm")
  confirm(@Param("eventId", ParseIntPipe) id: number, @Body() body: unknown) {
    // An older app sends no body at all; Nest then gives an empty object.
    return this.plan.confirmEvent(id, parse(confirmIncomeInput, body ?? {}).amount);
  }

  @Post("incomes/:eventId/date")
  setDate(@Param("eventId", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.plan.setEventDate(id, parse(incomeDateInput, body).date);
  }

  @Post("incomes/:eventId/match-transaction")
  matchTransaction(@Param("eventId", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.plan.matchTransaction(id, parse(matchTransactionInput, body).transactionId);
  }

  @Post("transactions/:id/not-usdc")
  dismissUsdcMatch(@Param("id", ParseIntPipe) id: number) {
    return this.plan.dismissUsdcMatch(id);
  }

  // --- payments -------------------------------------------------------------
  @Get("payments")
  listPayments(@Query("unpaid") unpaid?: string): Promise<ScheduledPayment[]> {
    return this.ds.getRepository(ScheduledPayment).find({
      where: unpaid === "1" ? { paid_at: null as never } : {},
      order: { due_on: "ASC", id: "ASC" },
    });
  }

  @Post("payments")
  async createPayment(@Body() body: unknown): Promise<ScheduledPayment> {
    const row = await this.plan.createPayment(parse(scheduledPaymentInput, body));
    await this.entries.freshLimit();
    return row;
  }

  @Patch("payments/:id")
  async patchPayment(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<ScheduledPayment> {
    const row = await this.ds.transaction(async (m) => {
      const r = await patchRow(m.getRepository(ScheduledPayment), id, parse(scheduledPaymentPatch, body));
      await this.plan.dropEstimate(m, r);
      return r;
    });
    await this.entries.freshLimit();
    return row;
  }

  @Delete("payments/:id")
  deletePayment(@Param("id", ParseIntPipe) id: number) {
    return this.entries.removePayment(id);
  }

  // --- installments ---------------------------------------------------------
  @Post("installments")
  createInstallment(@Body() body: unknown) {
    return this.entries.createInstallment(parse(installmentInput, body));
  }

  @Patch("installments/:name")
  patchInstallment(@Param("name") name: string, @Body() body: unknown) {
    return this.entries.patchInstallment(name, parse(installmentPatch, body));
  }

  @Delete("installments/:name")
  deleteInstallment(@Param("name") name: string) {
    return this.entries.removeInstallment(name);
  }

  @Post("payments/:id/mark-paid")
  markPaid(@Param("id", ParseIntPipe) id: number) {
    return this.plan.markPaid(id);
  }

  /** «Это оплата?» answered no: the operation did not pay this payment (task Б8). */
  @Post("payments/:id/not-paid-by")
  notPaidBy(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.plan.dismissPaymentMatch(id, parse(matchTransactionInput, body).transactionId);
  }

  // --- recurring payments ---------------------------------------------------
  @Get("recurring")
  listRecurring(): Promise<RecurringPayment[]> {
    return this.ds.getRepository(RecurringPayment).find({ order: { id: "ASC" } });
  }

  @Post("recurring")
  createRecurring(@Body() body: unknown): Promise<RecurringPayment> {
    return this.entries.createRecurring(parse(recurringInput, body));
  }

  @Patch("recurring/:id")
  patchRecurring(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<RecurringPayment> {
    return this.entries.patchRecurring(id, parse(recurringPatch, body));
  }

  @Delete("recurring/:id")
  deleteRecurring(@Param("id", ParseIntPipe) id: number) {
    return this.entries.removeRecurring(id);
  }

  // --- goals ----------------------------------------------------------------
  @Get("goals")
  listGoals(): Promise<GoalDto[]> {
    return goalDtos(this.ds.manager);
  }

  /**
   * A new goal (ЯМ5): kept in a place, it is in that place's currency and keeps nothing by hand (a hand amount sent with
   * it is not stored); without one, in dollars as before.
   */
  @Post("goals")
  async createGoal(@Body() body: unknown): Promise<GoalDto> {
    const { place, saved_cents, ...input } = parse(goalInput, body);
    const currency = place ? await goalPlaceCurrency(this.ds.manager, place) : "USD";
    const repo = this.ds.getRepository(Goal);
    const row = await repo.save(
      repo.create({ ...input, saved_cents: place ? 0 : (saved_cents ?? 0), currency, ...goalPlaceColumns(place ?? null) }),
    );
    return (await goalDtos(this.ds.manager, row.id))[0]!;
  }

  /**
   * A change (ЯМ5): a new place brings its currency, and a goal moving to another currency needs its new target in the
   * same request, or its old target would be read in the new currency. Without a place the goal keeps its currency.
   * The hand amount follows the same rule: moving to another currency starts it at 0 (dollars are never read as
   * hryvnias), and a hand amount is stored only for a goal left without a place — an older app editing «Накоплено, $»
   * on a goal kept in a place sends a number that means nothing there.
   */
  @Patch("goals/:id")
  async patchGoal(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<GoalDto> {
    const { place, saved_cents, ...data } = parse(goalPatch, body);
    const repo = this.ds.getRepository(Goal);
    const cur = await repo.findOneBy({ id });
    if (!cur) throw new NotFoundException();
    let moved: Partial<Goal> = {};
    if (place !== undefined) {
      const currency = place ? await goalPlaceCurrency(this.ds.manager, place) : cur.currency;
      if (currency !== cur.currency && data.target_cents === undefined) {
        throw new BadRequestException("a goal in another currency needs its new target");
      }
      moved = { currency, ...goalPlaceColumns(place), ...(currency !== cur.currency ? { saved_cents: 0 } : {}) };
    }
    const inPlace = place !== undefined ? place !== null : cur.account_id !== null || cur.manual_balance_id !== null;
    const hand = saved_cents !== undefined && !inPlace ? { saved_cents } : {};
    await patchRow(repo, id, { ...data, ...moved, ...hand });
    return (await goalDtos(this.ds.manager, id))[0]!;
  }

  /** Deletes the goal only: the money in its place stays where it is. */
  @Delete("goals/:id")
  deleteGoal(@Param("id", ParseIntPipe) id: number) {
    return removeRow(this.ds.getRepository(Goal), id);
  }

  // --- loans ----------------------------------------------------------------
  @Get("loans")
  async listLoans() {
    return (await this.ds.getRepository(Loan).find({ order: { received_on: "DESC", id: "DESC" } })).map(badCase);
  }

  @Post("loans")
  async createLoan(@Body() body: unknown) {
    const repo = this.ds.getRepository(Loan);
    const row = await repo.save(repo.create(parse(loanInput, body)));
    await this.limit.invalidate("loan");
    return badCase(row);
  }

  @Patch("loans/:id")
  async patchLoan(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const data = parse(loanPatch, body);
    const patch = data.repaid_at === undefined ? data : { ...data, repaid_at: data.repaid_at === null ? null : new Date(data.repaid_at) };
    const repo = this.ds.getRepository(Loan);
    if (data.due_on !== undefined || data.received_on !== undefined) {
      const loan = await repo.findOneBy({ id });
      if (!loan) throw new NotFoundException();
      // A loan is not returned before it was taken, whichever of the two days moves.
      const due = data.due_on !== undefined ? data.due_on : loan.due_on;
      if (due !== null && due < (data.received_on ?? loan.received_on)) throw new UnprocessableEntityException("return date is before the loan");
    }
    const row = await patchRow(repo, id, patch);
    await this.limit.invalidate("loan");
    return badCase(row);
  }

  @Get("loans/history")
  loanHistory() {
    return this.loans.history();
  }

  @Post("loans/old/repaid")
  repayOldLoans() {
    return this.loans.repayOld();
  }

  @Post("loans/:id/repay")
  repayLoan(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return this.loans.repay(id, parse(loanRepayInput, body));
  }

  @Delete("loans/:id")
  deleteLoan(@Param("id", ParseIntPipe) id: number) {
    return this.loans.remove(id);
  }

  // --- bank accounts (Д2а) ---------------------------------------------------
  // The person marks whether a bank account's money is own money, and names it. Own money is in the day's limit, so a
  // change of the mark fixes the day afresh in the same transaction; its purchases spend the limit either way.
  @Patch("accounts/:id")
  async patchAccount(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<AccountDto> {
    const data = parse(accountPatch, body);
    return this.ds.transaction(async (m) => {
      const before = (await m.query(`SELECT id, kind, counts_as_own, name, title FROM accounts WHERE id=$1 FOR UPDATE`, [id]))[0] as
        | { id: number; kind: AccountKind; counts_as_own: boolean | null; name: string | null; title: string | null }
        | undefined;
      if (!before) throw new NotFoundException();
      if (before.kind === "cash") throw new BadRequestException("the cash wallet is always own money");
      const after = {
        ...before,
        counts_as_own: data.countsAsOwn ?? before.counts_as_own,
        name: data.name === undefined ? before.name : data.name,
      };
      await m.query(`UPDATE accounts SET counts_as_own=$2, name=$3 WHERE id=$1`, [id, after.counts_as_own, after.name]);
      const own = countsAsOwn(after.kind, after.counts_as_own);
      if (own !== countsAsOwn(before.kind, before.counts_as_own)) await this.limit.invalidate("accounts", m);
      const kind = after.kind as BankAccountKind;
      return { id, kind, name: accountName({ kind, name: after.name, title: after.title }), countsAsOwn: own };
    });
  }

  // --- manual balances ------------------------------------------------------
  // Binance and the like are own money and count in the day's limit at once; a balance set aside
  // (`counts_as_own: false`, task Б19) is outside the limit, so changing it leaves the day's row alone.
  @Get("manual-balances")
  listBalances(): Promise<ManualBalance[]> {
    return this.ds.getRepository(ManualBalance).find({ order: { id: "ASC" } });
  }

  @Post("manual-balances")
  async createBalance(@Body() body: unknown): Promise<ManualBalance> {
    const repo = this.ds.getRepository(ManualBalance);
    const row = await repo.save(repo.create(parse(manualBalanceInput, body)));
    if (row.counts_as_own) await this.limit.invalidate("binance");
    return row;
  }

  @Patch("manual-balances/:id")
  async patchBalance(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<ManualBalance> {
    const repo = this.ds.getRepository(ManualBalance);
    const before = await repo.findOneBy({ id });
    if (!before) throw new NotFoundException();
    const row = await patchRow(repo, id, parse(manualBalancePatch, body));
    if (before.counts_as_own || row.counts_as_own) await this.limit.invalidate("binance");
    return row;
  }

  @Delete("manual-balances/:id")
  async deleteBalance(@Param("id", ParseIntPipe) id: number) {
    const repo = this.ds.getRepository(ManualBalance);
    const before = await repo.findOneBy({ id });
    const done = await removeRow(repo, id);
    if (before?.counts_as_own) await this.limit.invalidate("binance");
    return done;
  }
}

@Controller("settings")
export class SettingsController {
  constructor(
    @Inject(DataSource) private readonly ds: DataSource,
    @Inject(LimitService) private readonly limit: LimitService,
  ) {}

  @Get()
  get(): Promise<Settings | null> {
    return this.ds.getRepository(Settings).findOneBy({ id: 1 });
  }

  /** A new cap, food floor or tax figure is in the day's limit at once; the look of the limit is not money. */
  @Patch()
  async patch(@Body() body: unknown): Promise<Settings | null> {
    const data = parse(settingsPatch, body);
    const repo = this.ds.getRepository(Settings);
    if (Object.keys(data).length > 0) await repo.update(1, data);
    if (Object.keys(data).some((k) => k !== "limit_visual")) await this.limit.invalidate("settings");
    return repo.findOneBy({ id: 1 });
  }
}
