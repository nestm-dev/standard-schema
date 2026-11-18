import type { ArgumentMetadata } from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

import {
  createValidationProblemFactory,
  toJsonPointer,
  ValidationProblemException,
} from './validation-problem.js';

const body: ArgumentMetadata = { type: 'body' };

async function issuesOf(
  schema: StandardSchemaV1,
  value: unknown,
): Promise<readonly StandardSchemaV1.Issue[]> {
  const result = await schema['~standard'].validate(value);

  if (result.issues === undefined) {
    throw new Error('Expected validation to fail.');
  }

  return result.issues;
}

describe(toJsonPointer.name, () => {
  it('points at the whole value for an empty or missing path', () => {
    expect(toJsonPointer([])).toBe('');
    expect(toJsonPointer()).toBe('');
  });

  it('escapes "~" before "/" as RFC 6901 requires', () => {
    expect(toJsonPointer(['a/b', 'c~d', '~1', 'e~/f'])).toBe(
      '/a~1b/c~0d/~01/e~0~1f',
    );
  });

  it('accepts numeric indexes and Standard Schema path segments', () => {
    expect(toJsonPointer(['items', 0, { key: 'tags' }, { key: 2 }])).toBe(
      '/items/0/tags/2',
    );
  });

  it('keeps empty keys as empty reference tokens', () => {
    expect(toJsonPointer([''])).toBe('/');
    expect(toJsonPointer(['a', '', 'b'])).toBe('/a//b');
  });
});

describe(createValidationProblemFactory.name, () => {
  it('builds an RFC 9457 validation problem with defaults', async () => {
    const schema = z.object({ name: z.string().min(1) });
    const exception = createValidationProblemFactory()(
      await issuesOf(schema, { name: '' }),
      body,
    );

    expect(exception).toBeInstanceOf(ValidationProblemException);
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toEqual({
      type: 'validation-failed',
      title: 'Request validation failed',
      status: 400,
      detail: '1 validation error in the request body.',
      errors: [
        {
          in: 'body',
          pointer: '/name',
          code: 'too_small',
          message: expect.any(String),
        },
      ],
    });
  });

  it('points into nested arrays', async () => {
    const schema = z.object({
      items: z.array(
        z.object({
          sku: z.string(),
          tags: z.array(z.string().min(1)),
        }),
      ),
    });
    const { problem } = createValidationProblemFactory()(
      await issuesOf(schema, {
        items: [
          { sku: 'A', tags: ['ok'] },
          { sku: 7, tags: ['ok', ''] },
        ],
      }),
      body,
    );

    expect(
      problem.errors.map(({ pointer, code }) => ({ pointer, code })),
    ).toEqual([
      { pointer: '/items/1/sku', code: 'invalid_type' },
      { pointer: '/items/1/tags/1', code: 'too_small' },
    ]);
    expect(problem.detail).toBe('2 validation errors in the request body.');
  });

  it('escapes keys containing "/" and "~"', async () => {
    const schema = z.object({
      'a/b': z.string(),
      'c~d': z.object({ 'e~/f': z.number() }),
    });
    const { problem } = createValidationProblemFactory()(
      await issuesOf(schema, { 'a/b': 1, 'c~d': { 'e~/f': 'x' } }),
      body,
    );

    expect(problem.errors.map(({ pointer }) => pointer)).toEqual([
      '/a~1b',
      '/c~0d/e~0~1f',
    ]);
  });

  it('expands unrecognized keys into one entry per key', async () => {
    const schema = z.object({
      name: z.string(),
      meta: z.strictObject({ id: z.number() }),
    });
    const strict = z.strictObject({ name: z.string() });

    const nested = createValidationProblemFactory()(
      await issuesOf(schema, {
        name: 'Keyboard',
        meta: { id: 1, 'x/y': true, 'z~': false },
      }),
      body,
    );
    const root = createValidationProblemFactory()(
      await issuesOf(strict, { name: 'Keyboard', extra: 1 }),
      body,
    );

    expect(nested.problem.errors).toEqual([
      {
        in: 'body',
        pointer: '/meta/x~1y',
        code: 'unrecognized_keys',
        message: 'Unrecognized key: "x/y"',
      },
      {
        in: 'body',
        pointer: '/meta/z~0',
        code: 'unrecognized_keys',
        message: 'Unrecognized key: "z~"',
      },
    ]);
    expect(nested.problem.detail).toBe(
      '2 validation errors in the request body.',
    );
    expect(root.problem.errors).toEqual([
      {
        in: 'body',
        pointer: '/extra',
        code: 'unrecognized_keys',
        message: 'Unrecognized key: "extra"',
      },
    ]);
  });

  it('maps parameter types to request parts', async () => {
    const issues = await issuesOf(z.object({ id: z.uuid() }), { id: 'x' });
    const factory = createValidationProblemFactory();

    expect(factory(issues, { type: 'query' }).problem).toMatchObject({
      detail: '1 validation error in the query string.',
      errors: [{ in: 'query', pointer: '/id' }],
    });
    expect(factory(issues, { type: 'param' }).problem).toMatchObject({
      detail: '1 validation error in the path parameters.',
      errors: [{ in: 'path', pointer: '/id' }],
    });

    const custom = factory(issues, { type: 'custom' }).problem;

    expect(custom.detail).toBe('1 validation error in the request.');
    expect(custom.errors[0]).not.toHaveProperty('in');
  });

  it('lets custom parameters be mapped to headers', async () => {
    const issues = await issuesOf(z.string().min(8), 'short');
    const factory = createValidationProblemFactory({
      location: (metadata) => (metadata.type === 'custom' ? 'header' : 'body'),
    });

    expect(
      factory(issues, { type: 'custom', data: 'x-api-key' }).problem.errors,
    ).toEqual([
      {
        in: 'header',
        pointer: '/x-api-key',
        code: 'too_small',
        message: expect.any(String),
      },
    ]);
  });

  it('prefixes a named parameter to the pointer', async () => {
    const issues = await issuesOf(z.object({ city: z.string() }), {});
    const { problem } = createValidationProblemFactory()(issues, {
      type: 'body',
      data: 'shipping/address',
    });

    expect(problem.errors[0]?.pointer).toBe('/shipping~1address/city');
  });

  it('honors type, title, status, detail, and error limit options', async () => {
    const schema = z.object({ a: z.string(), b: z.string(), c: z.string() });
    const factory = createValidationProblemFactory({
      typeBaseUri: 'https://example.com/problems/',
      typeSlug: 'invalid-request',
      title: 'Invalid request',
      status: 422,
      maxErrors: 2,
      detail: (errors, metadata) =>
        `${errors.length} invalid ${metadata.type} fields`,
    });

    const exception = factory(await issuesOf(schema, {}), body);

    expect(exception.getStatus()).toBe(422);
    expect(exception.problem).toMatchObject({
      type: 'https://example.com/problems/invalid-request',
      title: 'Invalid request',
      status: 422,
      detail: '3 invalid body fields',
    });
    expect(exception.problem.errors).toHaveLength(2);
    expect(
      createValidationProblemFactory({ detail: 'Fix the request.' })(
        await issuesOf(schema, {}),
        body,
      ).problem.detail,
    ).toBe('Fix the request.');
  });

  it('reads vendor-neutral issue codes', () => {
    const factory = createValidationProblemFactory();
    const issues = [
      { message: 'ArkType-like', code: 'predicate', path: ['a'] },
      { message: 'Valibot-like', type: 'min_length', path: [{ key: 'b' }] },
      { message: 'Plain' },
    ] as unknown as StandardSchemaV1.Issue[];

    expect(factory(issues, body).problem.errors).toEqual([
      { in: 'body', pointer: '/a', code: 'predicate', message: 'ArkType-like' },
      {
        in: 'body',
        pointer: '/b',
        code: 'min_length',
        message: 'Valibot-like',
      },
      { in: 'body', pointer: '', code: 'invalid', message: 'Plain' },
    ]);
  });
});
