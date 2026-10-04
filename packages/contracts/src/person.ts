import { z } from 'zod';
import { id } from './common.js';

/** Person: holder of incomes, cards and loans (informative, RF-02). Read-only through the API. */
export const person = z.object({ id, name: z.string(), isUser: z.boolean() });
export type Person = z.infer<typeof person>;
