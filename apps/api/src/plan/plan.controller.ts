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
} from "@nestjs/common";
import {
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
import { LimitService } from "../today/limit.service";
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
  listExpected(): Promise<ExpectedIncome[]> {
    return this.ds.getRepository(ExpectedIncome).find({ order: { id: "ASC" } });
  }

  @Post("expected-incomes")
  async createExpected(@Body() body: unknown): Promise<ExpectedIncome> {
    const repo = this.ds.getRepository(ExpectedIncome);
    const row = await repo.save(repo.create(parse(expectedIncomeInput, body)));
    await this.entries.generated();
    return row;
  }

  @Patch("expected-incomes/:id")
  async patchExpected(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<ExpectedIncome> {
    const data = parse(expectedIncomePatch, body);
    const repo = this.ds.getRepository(ExpectedIncome);
    const cur = await repo.findOneBy({ id });
    if (!cur) throw new NotFoundException();
    const merged = { ...cur, ...data };
    if (merged.window_start_day > merged.window_end_day) throw new BadRequestException("window start is after its end");
    return this.entries.patchExpected(id, data);
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
  confirm(@Param("eventId", ParseIntPipe) id: number) {
    return this.plan.confirmEvent(id);
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
  async deletePayment(@Param("id", ParseIntPipe) id: number) {
    const done = await removeRow(this.ds.getRepository(ScheduledPayment), id);
    await this.entries.freshLimit();
    return done;
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

  // --- recurring payments ---------------------------------------------------
  @Get("recurring")
  listRecurring(): Promise<RecurringPayment[]> {
    return this.ds.getRepository(RecurringPayment).find({ order: { id: "ASC" } });
  }

  @Post("recurring")
  async createRecurring(@Body() body: unknown): Promise<RecurringPayment> {
    const repo = this.ds.getRepository(RecurringPayment);
    const row = await repo.save(repo.create(parse(recurringInput, body)));
    await this.entries.generated();
    return row;
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
  listGoals() {
    return this.ds.getRepository(Goal).find({ order: { sort: "ASC", id: "ASC" } });
  }

  @Post("goals")
  createGoal(@Body() body: unknown) {
    const repo = this.ds.getRepository(Goal);
    return repo.save(repo.create(parse(goalInput, body)));
  }

  @Patch("goals/:id")
  patchGoal(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    return patchRow(this.ds.getRepository(Goal), id, parse(goalPatch, body));
  }

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
    const row = await patchRow(this.ds.getRepository(Loan), id, patch);
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
