import { z } from 'zod';

/** UUID primary key. */
export const id = z.uuid();

/** Date without time, 'YYYY-MM-DD', and a real calendar date. */
export const isoDate = z.iso.date();

/** Period: 'YYYY-MM-01' (D6). */
export const period = z.iso.date().refine((v) => v.endsWith('-01'), { message: 'period' });

export const currency = z.enum(['ARS', 'USD', 'UYU']);
export const currencyPair = z.enum(['USD_ARS', 'UYU_USD']);
export const country = z.enum(['AR', 'UY']);

/** Periodicity (D7): every 1, 2, 3, 6 or 12 months, aligned to a month of the year. */
export const EVERY_MONTHS = [1, 2, 3, 6, 12] as const;
export const everyMonths = z
  .number()
  .int()
  .refine((v) => (EVERY_MONTHS as readonly number[]).includes(v), { message: 'choice' });
export const monthOfYear = z.number().int().min(1, { message: 'choice' }).max(12, { message: 'choice' });
/** Day of the month; 31 = last day of the month. */
export const dayOfMonth = z.number().int().min(1, { message: 'day' }).max(31, { message: 'day' });

/**
 * Decimal as a string, never a JS number (RNF-10). `scale` = max decimals, `integer` = max digits
 * before the point, matching the numeric column. Accepts '1450' or '1450.25'.
 */
export const decimalString = (integer: number, scale: number) =>
  z
    .string()
    .trim()
    .min(1, { message: 'required' })
    .regex(new RegExp(`^\\d{1,${integer}}(\\.\\d{1,${scale}})?$`), { message: 'decimal' });

/** Amount: numeric(14,2). */
export const amount = decimalString(12, 2);
/** Exchange rate or index: numeric(14,6). */
export const rate = decimalString(8, 6);
/** Amount greater than zero, checked on the string (never converted to number). */
export const positiveAmount = amount.refine((v) => /[1-9]/.test(v), { message: 'must_be_positive' });

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

/** Field error codes; the PWA translates each one with the glossary (`ui.invalid_<code>`). */
export type FieldCode = 'required' | 'decimal' | 'must_be_positive' | 'date' | 'period' | 'choice' | 'day' | 'range' | 'month_mismatch' | 'installments' | 'uva_principal' | 'empty' | 'default';
const OWN_CODES = new Set<string>(['required', 'decimal', 'must_be_positive', 'date', 'period', 'choice', 'day', 'range', 'month_mismatch', 'installments', 'uva_principal', 'empty']);

/** Maps a zod issue to a field code: our own messages pass through, zod's built-ins are classified. */
export function fieldCode(issue: z.core.$ZodIssue): FieldCode {
  if (OWN_CODES.has(issue.message)) return issue.message as FieldCode;
  switch (issue.code) {
    case 'invalid_value':
      return 'choice';
    case 'invalid_format':
      return issue.format === 'date' ? 'date' : 'default';
    case 'invalid_type':
      // zod 4 does not include the input in the issue; its message says what was received
      return /received undefined/.test(issue.message) ? 'required' : 'default';
    case 'too_small':
      return 'required';
    default:
      return 'default';
  }
}

/** All field errors of a failed parse, first error per field ('_' for the whole object). */
export function fieldErrors(error: { issues: readonly z.core.$ZodIssue[] }): Record<string, FieldCode> {
  const fields: Record<string, FieldCode> = {};
  for (const issue of error.issues) fields[issue.path.join('.') || '_'] ??= fieldCode(issue);
  return fields;
}
