import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './harness';

let app: NestFastifyApplication;

beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('the OpenAPI document', () => {
  it('describes bodies, responses and errors with real schemas', async () => {
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    const doc = response.json<{
      tags: { name: string }[];
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: unknown;
            responses: Record<
              string,
              { content?: Record<string, { schema: { properties?: Record<string, unknown> } }> }
            >;
          }
        >
      >;
    }>();
    expect(doc.tags.map((t) => t.name)).toEqual([
      'resources',
      'bookings',
      'payments',
      'fake-psp',
      'meta',
    ]);
    const post = doc.paths['/bookings']?.post;
    if (!post) throw new Error('POST /bookings missing');
    expect(post.requestBody).toBeTruthy();
    expect(
      Object.keys(post.responses['201']?.content?.['application/json']?.schema.properties ?? {}),
    ).toContain('payment');
    expect(
      Object.keys(post.responses['409']?.content?.['application/json']?.schema.properties ?? {}),
    ).toEqual(['code', 'message']);
    expect(doc.paths['/bookings/{id}']?.delete?.responses['403']).toBeTruthy();
    expect(doc.paths['/webhooks/payments']?.post).toBeTruthy();
    expect(doc.paths['/fake-psp/payments/{paymentId}/pay']?.post?.requestBody).toBeTruthy();
  });

  it('serves Swagger UI', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs' });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('swagger-ui');
  });
});
