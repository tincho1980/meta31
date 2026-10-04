import type { ApiError } from '@meta31/contracts';
import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';

/**
 * zod validation for a route input, answering with the API error format:
 * 400 { error: 'validation_error', fields: { 'path.to.field': 'message_code' } }.
 */
export function validate<T extends z.ZodType, Target extends keyof ValidationTargets>(target: Target, schema: T) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return;
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || '_';
      fields[path] ??= issue.message;
    }
    return c.json({ error: 'validation_error', fields } satisfies ApiError, 400);
  });
}

/** `:id` path parameter. */
export const idParam = z.object({ id: z.uuid() });
