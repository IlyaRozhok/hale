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
  incomeDateInput,
  loanInput,
  loanPatch,
  manualBalanceInput,
  manualBalancePatch,
  matchTransactionInput,
  scheduledPaymentInput,
  scheduledPaymentPatch,
  settingsPatch,
} from "@tablo/contracts";
import { DataSource, type ObjectLiteral, type Repository } from "typeorm";
import type { z } from "zod";
import { ExpectedIncome, Loan, ManualBalance, ScheduledPayment, Settings } from "../db/entities";
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
  ) {}

  // --- expected incomes -----------------------------------------------------
  @Get("expected-incomes")
  listExpected(): Promise<ExpectedIncome[]> {
    return this.ds.getRepository(ExpectedIncome).find({ order: { id: "ASC" } });
  }

  @Post("expected-incomes")
  createExpected(@Body() body: unknown): Promise<ExpectedIncome> {
    const repo = this.ds.getRepository(ExpectedIncome);
    return repo.save(repo.create(parse(expectedIncomeInput, body)));
  }

  @Patch("expected-incomes/:id")
  async patchExpected(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<ExpectedIncome> {
    const data = parse(expectedIncomePatch, body);
    const repo = this.ds.getRepository(ExpectedIncome);
    const cur = await repo.findOneBy({ id });
    if (!cur) throw new NotFoundException();
    const merged = { ...cur, ...data };
    if (merged.window_start_day > merged.window_end_day) throw new BadRequestException("window start is after its end");
    return patchRow(repo, id, data);
  }

  @Delete("expected-incomes/:id")
  async deleteExpected(@Param("id", ParseIntPipe) id: number): Promise<{ deleted: true }> {
    return this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM income_events WHERE expected_income_id=$1`, [id]);
      return removeRow(m.getRepository(ExpectedIncome), id);
    });
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

  // --- payments -------------------------------------------------------------
  @Get("payments")
  listPayments(@Query("unpaid") unpaid?: string): Promise<ScheduledPayment[]> {
    return this.ds.getRepository(ScheduledPayment).find({
      where: unpaid === "1" ? { paid_at: null as never } : {},
      order: { due_on: "ASC", id: "ASC" },
    });
  }

  @Post("payments")
  createPayment(@Body() body: unknown): Promise<ScheduledPayment> {
    const repo = this.ds.getRepository(ScheduledPayment);
    return repo.save(repo.create(parse(scheduledPaymentInput, body)));
  }

  @Patch("payments/:id")
  patchPayment(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<ScheduledPayment> {
    return patchRow(this.ds.getRepository(ScheduledPayment), id, parse(scheduledPaymentPatch, body));
  }

  @Delete("payments/:id")
  deletePayment(@Param("id", ParseIntPipe) id: number) {
    return removeRow(this.ds.getRepository(ScheduledPayment), id);
  }

  @Post("payments/:id/mark-paid")
  markPaid(@Param("id", ParseIntPipe) id: number) {
    return this.plan.markPaid(id);
  }

  // --- loans ----------------------------------------------------------------
  @Get("loans")
  async listLoans() {
    return (await this.ds.getRepository(Loan).find({ order: { received_on: "DESC", id: "DESC" } })).map(badCase);
  }

  @Post("loans")
  async createLoan(@Body() body: unknown) {
    const repo = this.ds.getRepository(Loan);
    return badCase(await repo.save(repo.create(parse(loanInput, body))));
  }

  @Patch("loans/:id")
  async patchLoan(@Param("id", ParseIntPipe) id: number, @Body() body: unknown) {
    const data = parse(loanPatch, body);
    const patch = data.repaid_at === undefined ? data : { ...data, repaid_at: data.repaid_at === null ? null : new Date(data.repaid_at) };
    return badCase(await patchRow(this.ds.getRepository(Loan), id, patch));
  }

  @Delete("loans/:id")
  deleteLoan(@Param("id", ParseIntPipe) id: number) {
    return removeRow(this.ds.getRepository(Loan), id);
  }

  // --- manual balances ------------------------------------------------------
  @Get("manual-balances")
  listBalances(): Promise<ManualBalance[]> {
    return this.ds.getRepository(ManualBalance).find({ order: { id: "ASC" } });
  }

  @Post("manual-balances")
  createBalance(@Body() body: unknown): Promise<ManualBalance> {
    const repo = this.ds.getRepository(ManualBalance);
    return repo.save(repo.create(parse(manualBalanceInput, body)));
  }

  @Patch("manual-balances/:id")
  patchBalance(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<ManualBalance> {
    return patchRow(this.ds.getRepository(ManualBalance), id, parse(manualBalancePatch, body));
  }

  @Delete("manual-balances/:id")
  deleteBalance(@Param("id", ParseIntPipe) id: number) {
    return removeRow(this.ds.getRepository(ManualBalance), id);
  }
}

@Controller("settings")
export class SettingsController {
  constructor(@Inject(DataSource) private readonly ds: DataSource) {}

  @Get()
  get(): Promise<Settings | null> {
    return this.ds.getRepository(Settings).findOneBy({ id: 1 });
  }

  @Patch()
  async patch(@Body() body: unknown): Promise<Settings | null> {
    const data = parse(settingsPatch, body);
    const repo = this.ds.getRepository(Settings);
    if (Object.keys(data).length > 0) await repo.update(1, data);
    return repo.findOneBy({ id: 1 });
  }
}
