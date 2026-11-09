import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseIntPipe, Patch, Post } from "@nestjs/common";
import {
  cashCountInput,
  cashOperationInput,
  cashOperationPatch,
  cashStartInput,
  type CashWalletDto,
  type TransactionDto,
} from "@hale/contracts";
import type { z } from "zod";
import { CashService } from "./cash.service";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return r.data;
}

@Controller("cash")
export class CashController {
  constructor(@Inject(CashService) private readonly cash: CashService) {}

  @Get()
  wallet(): Promise<CashWalletDto> {
    return this.cash.wallet();
  }

  @Post("start")
  start(@Body() body: unknown): Promise<CashWalletDto> {
    return this.cash.start(parse(cashStartInput, body));
  }

  @Post("operations")
  add(@Body() body: unknown): Promise<TransactionDto> {
    return this.cash.add(parse(cashOperationInput, body));
  }

  @Patch("operations/:id")
  change(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<TransactionDto> {
    return this.cash.change(id, parse(cashOperationPatch, body));
  }

  @Delete("operations/:id")
  remove(@Param("id", ParseIntPipe) id: number): Promise<{ deleted: true }> {
    return this.cash.remove(id);
  }

  @Post("count")
  count(@Body() body: unknown): Promise<CashWalletDto> {
    return this.cash.count(parse(cashCountInput, body));
  }

  @Post("deposits/:id/from-wallet")
  fromWallet(@Param("id", ParseIntPipe) id: number): Promise<CashWalletDto> {
    return this.cash.fromWallet(id);
  }
}
