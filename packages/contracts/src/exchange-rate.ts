import { z } from 'zod';
import { currencyPair, id, isoDate, rate } from './common.js';

/**
 * Exchange rate (RF-04). `rate` = local currency units per USD for both pairs
 * (USD_ARS ≈ 1450, UYU_USD ≈ 40; see modelo-de-datos.md). `validFrom` may be backdated.
 */
export const exchangeRate = z.object({
  id,
  pair: currencyPair,
  validFrom: isoDate,
  rate: z.string(),
});
export type ExchangeRate = z.infer<typeof exchangeRate>;

// positive without converting to number: at least one non-zero digit
const positiveRate = rate.refine((v) => /[1-9]/.test(v), { message: 'must_be_positive' });

export const exchangeRateCreate = z.object({ pair: currencyPair, validFrom: isoDate, rate: positiveRate });
export type ExchangeRateCreate = z.infer<typeof exchangeRateCreate>;

export const exchangeRateUpdate = z
  .object({ validFrom: isoDate, rate: positiveRate })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty_update' });
export type ExchangeRateUpdate = z.infer<typeof exchangeRateUpdate>;

export const exchangeRateListQuery = z.object({ pair: currencyPair.optional() });
