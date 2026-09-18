import { z } from 'zod';

/**
 * Zod 4 emits JSON Schema; Swagger accepts it as a schema object for bodies and responses.
 * `z.coerce.date()` has no JSON representation, so dates are documented as ISO 8601 strings.
 */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    unrepresentable: 'any',
    override: (ctx) => {
      if (ctx.zodSchema._zod.def.type === 'date') {
        ctx.jsonSchema.type = 'string';
        ctx.jsonSchema.format = 'date-time';
      }
    },
  }) as Record<string, unknown>;
}

export const errorSchema = z.object({
  code: z.string().describe('Stable machine-readable reason, e.g. no_capacity'),
  message: z.string(),
});

export const ERROR = jsonSchema(errorSchema);
