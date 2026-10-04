import { z } from 'zod';

/** UUID primary key. */
export const id = z.uuid();

/** Date without time, 'YYYY-MM-DD', and a real calendar date. */
export const isoDate = z.iso.date();

/** Period: 'YYYY-MM-01' (D6). */
export const period = z.iso.date().refine((v) => v.endsWith('-01'), { message: 'period_day_1' });

export const currency = z.enum(['ARS', 'USD', 'UYU']);
export const currencyPair = z.enum(['USD_ARS', 'UYU_USD']);

/**
 * Decimal as a string, never a JS number (RNF-10). `scale` = max decimals, `integer` = max digits
 * before the point, matching the numeric column. Accepts '1450' or '1450.25'.
 */
export const decimalString = (integer: number, scale: number) =>
  z
    .string()
    .trim()
    .regex(new RegExp(`^\\d{1,${integer}}(\\.\\d{1,${scale}})?$`), { message: 'invalid_decimal' });

/** Amount: numeric(14,2). */
export const amount = decimalString(12, 2);
/** Exchange rate or index: numeric(14,6). */
export const rate = decimalString(8, 6);

/** Non-empty trimmed text. */
export const text = (max = 200) => z.string().trim().min(1, { message: 'required' }).max(max);

/** Error body of every failed request: a stable code the PWA translates with the glossary. */
export const apiError = z.object({
  error: z.enum(['unauthorized', 'forbidden', 'not_found', 'validation_error', 'conflict', 'internal_error']),
  /** For validation errors: field path → message code. */
  fields: z.record(z.string(), z.string()).optional(),
  /** For conflicts: which rule was hit. */
  reason: z.string().optional(),
});
export type ApiError = z.infer<typeof apiError>;
