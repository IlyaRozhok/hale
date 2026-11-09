import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseIntPipe, Patch, Post } from "@nestjs/common";
import {
  cashCardAnswer,
  cashCardPatch,
  cashCountInput,
  cashOperationInput,
  cashOperationPatch,
  cashStartInput,
  paymentLinksInput,
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

  @Post("cards/:id")
  answerCard(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<CashWalletDto> {
    return this.cash.answerCard(id, parse(cashCardAnswer, body));
  }

  @Patch("cards/:id")
  setCardCash(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<CashWalletDto> {
    return this.cash.setCardCash(id, parse(cashCardPatch, body).amount);
  }

  @Get("payments/:id/candidates")
  candidates(@Param("id", ParseIntPipe) id: number): Promise<TransactionDto[]> {
    return this.cash.candidates(id);
  }

  @Post("payments/:id/links")
  async link(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<{ linked: number }> {
    return this.cash.payWith(id, parse(paymentLinksInput, body).transactionIds);
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

  @Post("payments/:id")
  payPlanned(@Param("id", ParseIntPipe) id: number): Promise<CashWalletDto> {
    return this.cash.payPlanned(id);
  }

  @Post("deposits/:id/from-wallet")
  fromWallet(@Param("id", ParseIntPipe) id: number): Promise<CashWalletDto> {
    return this.cash.fromWallet(id);
  }
}
