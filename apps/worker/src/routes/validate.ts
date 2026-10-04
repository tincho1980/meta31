import { type ApiError, fieldErrors } from '@meta31/contracts';
import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';

/**
 * zod validation for a route input, answering with the API error format:
 * 400 { error: 'validation_error', fields: { 'path.to.field': 'field_code' } }, with the same
 * field codes the PWA computes before sending (contracts `fieldErrors`).
 */
export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return;
    return c.json({ error: 'validation_error', fields: fieldErrors(result.error) } satisfies ApiError, 400);
  });
}

/** `:id` path parameter. */
export const idParam = z.object({ id: z.uuid() });
