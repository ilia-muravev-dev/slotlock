import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createBookingSchema, createdBookingSchema } from '../../src/bookings/bookings.dto';
import { ERROR, jsonSchema } from '../../src/common/openapi';

describe('jsonSchema', () => {
  it('documents coerced dates as ISO 8601 strings', () => {
    const schema = jsonSchema(createBookingSchema) as {
      properties: Record<string, { type: string; format?: string }>;
    };
    expect(schema.properties.startsAt).toMatchObject({ type: 'string', format: 'date-time' });
    expect(schema.properties.resourceId).toMatchObject({ type: 'string' });
  });

  it('renders the response and error shapes', () => {
    const created = jsonSchema(createdBookingSchema) as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(created.properties)).toEqual(
      expect.arrayContaining(['id', 'status', 'payment', 'holdExpiresAt']),
    );
    expect(created.required).toContain('payment');
    expect(ERROR).toMatchObject({ type: 'object', required: ['code', 'message'] });
    expect(jsonSchema(z.object({ n: z.int().nullable() }))).toMatchObject({ type: 'object' });
  });
});
