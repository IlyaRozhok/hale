import { z } from "zod";

// Objects are non-strict: unknown fields are dropped, not rejected.
// `type` stays a string so a new monobank account type cannot break parsing.
export const monoAccountSchema = z.object({
  id: z.string().min(1),
  sendId: z.string().optional(),
  balance: z.number().int(),
  creditLimit: z.number().int().default(0),
  type: z.string(),
  currencyCode: z.number().int(),
  cashbackType: z.string().optional(),
  maskedPan: z.array(z.string()).default([]),
  iban: z.string().optional(),
});

export const monoJarSchema = z.object({
  id: z.string().min(1),
  sendId: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  currencyCode: z.number().int(),
  balance: z.number().int(),
  goal: z.number().int().nullish(),
});

export const monoClientInfoSchema = z.object({
  clientId: z.string(),
  name: z.string(),
  webHookUrl: z.string().optional(),
  permissions: z.string().optional(),
  accounts: z.array(monoAccountSchema).default([]),
  jars: z.array(monoJarSchema).default([]),
});

export const monoStatementItemSchema = z.object({
  id: z.string().min(1),
  time: z.number().int(),
  description: z.string(),
  mcc: z.number().int(),
  originalMcc: z.number().int(),
  hold: z.boolean(),
  amount: z.number().int(),
  operationAmount: z.number().int(),
  currencyCode: z.number().int(),
  commissionRate: z.number().int(),
  cashbackAmount: z.number().int(),
  balance: z.number().int(),
  comment: z.string().optional(),
  receiptId: z.string().optional(),
  invoiceId: z.string().optional(),
  counterEdrpou: z.string().optional(),
  counterIban: z.string().optional(),
  counterName: z.string().optional(),
});

export const monoRateSchema = z.object({
  currencyCodeA: z.number().int(),
  currencyCodeB: z.number().int(),
  date: z.number().int(),
  rateBuy: z.number().optional(),
  rateSell: z.number().optional(),
  rateCross: z.number().optional(),
});

export const monoStatementSchema = z.array(monoStatementItemSchema);
export const monoRatesSchema = z.array(monoRateSchema);

export type MonoAccount = z.infer<typeof monoAccountSchema>;
export type MonoJar = z.infer<typeof monoJarSchema>;
export type MonoClientInfo = z.infer<typeof monoClientInfoSchema>;
export type MonoStatementItem = z.infer<typeof monoStatementItemSchema>;
export type MonoRate = z.infer<typeof monoRateSchema>;
