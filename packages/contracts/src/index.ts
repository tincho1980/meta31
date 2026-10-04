// API contracts shared by the Worker (validation) and the PWA (forms and types).
export * from './category.js';
export * from './common.js';
export * from './exchange-rate.js';
export * from './income-source.js';
export * from './person.js';
export * from './property.js';

import { z } from 'zod';

/** Authenticated user (GET /api/me). */
export const me = z.object({ id: z.uuid(), name: z.string(), email: z.string() });
export type Me = z.infer<typeof me>;
