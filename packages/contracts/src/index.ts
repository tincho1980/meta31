// API contracts shared by the Worker (validation) and the PWA (forms and types).
export * from './amount-history.js';
export * from './card-items.js';
export * from './card-statement.js';
export * from './category.js';
export * from './common.js';
export * from './credit-card.js';
export * from './exchange-rate.js';
export * from './income-source.js';
export * from './loan.js';
export * from './one-off-expense.js';
export * from './one-off-income.js';
export * from './person.js';
export * from './projection.js';
export * from './property.js';
export * from './recurring-expense.js';

import { z } from 'zod';

/** Authenticated user (GET /api/me). */
export const me = z.object({ id: z.uuid(), name: z.string(), email: z.string() });
export type Me = z.infer<typeof me>;
