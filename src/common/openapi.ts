import { z } from 'zod';

/** Zod 4 emits JSON Schema; Swagger accepts it as a schema object for bodies and responses. */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<string, unknown>;
}
