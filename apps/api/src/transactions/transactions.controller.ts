import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  recipientLabelInput,
  type RecipientLabelResultDto,
  transactionPatch,
  type TransactionEditDto,
  type TransactionPageDto,
  transactionsQuery,
} from "@tablo/contracts";
import type { z } from "zod";
import { InvalidCursorError, TransactionsService } from "./transactions.service";

function parse<S extends z.ZodType>(schema: S, body: unknown): z.infer<S> {
  const r = schema.safeParse(body);
  if (!r.success) {
    throw new BadRequestException(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
  }
  return r.data;
}

@Controller()
export class TransactionsController {
  constructor(@Inject(TransactionsService) private readonly tx: TransactionsService) {}

  @Get("transactions")
  async list(@Query() query: unknown): Promise<TransactionPageDto> {
    try {
      return await this.tx.list(parse(transactionsQuery, query));
    } catch (e) {
      if (e instanceof InvalidCursorError) throw new BadRequestException("cursor: invalid");
      throw e;
    }
  }

  @Patch("transactions/:id")
  edit(@Param("id", ParseIntPipe) id: number, @Body() body: unknown): Promise<TransactionEditDto> {
    return this.tx.edit(id, parse(transactionPatch, body));
  }

  @Post("recipients/label")
  label(@Body() body: unknown): Promise<RecipientLabelResultDto> {
    const b = parse(recipientLabelInput, body);
    return this.tx.labelRecipient(b.counterKey, b.label);
  }
}
