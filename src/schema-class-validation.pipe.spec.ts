import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

import { createSchemaClass } from './create-schema-class.js';
import { SchemaClassValidationPipe } from './schema-class-validation.pipe.js';
import { ValidationProblemException } from './validation-problem.js';

const CreateProductSchema = z.object({
  name: z.string().trim().min(1),
  price: z.coerce.number().nonnegative(),
  active: z.boolean().default(true),
});

class CreateProduct extends createSchemaClass(CreateProductSchema) {}

const AsyncVendorNeutralSchema: StandardSchemaV1<unknown, { value: number }> = {
  '~standard': {
    version: 1,
    vendor: 'test',
    async validate(input) {
      const value =
        typeof input === 'object' &&
        input !== null &&
        'value' in input &&
        typeof input.value === 'string'
          ? Number(input.value)
          : Number.NaN;

      return Number.isFinite(value)
        ? { value: { value } }
        : { issues: [{ message: 'Expected a numeric value' }] };
    },
  },
};

class AsyncVendorNeutralInput extends createSchemaClass(
  AsyncVendorNeutralSchema,
) {}

const bodyMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateProduct,
};

describe(SchemaClassValidationPipe.name, () => {
  it('infers the class schema and returns Nest native parsed output', async () => {
    const pipe = new SchemaClassValidationPipe();

    const result = await pipe.transform(
      {
        name: '  Keyboard  ',
        price: '49.90',
        ignored: true,
      },
      bodyMetadata,
    );

    expect(result).toEqual({
      name: 'Keyboard',
      price: 49.9,
      active: true,
    });
  });

  it('keeps an explicit native metadata schema as the highest priority', async () => {
    const pipe = new SchemaClassValidationPipe();
    const explicitSchema = z.object({
      page: z.coerce.number().int().positive(),
    });

    const result = await pipe.transform(
      { page: '2' },
      {
        ...bodyMetadata,
        schema: explicitSchema,
      },
    );

    expect(result).toEqual({ page: 2 });
  });

  it('preserves Nest native validation exceptions', async () => {
    const pipe = new SchemaClassValidationPipe();

    await expect(
      pipe.transform({ name: '', price: -1 }, bodyMetadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes values without an explicit or class-carried schema through', async () => {
    const pipe = new SchemaClassValidationPipe();
    const input = { untouched: true };

    const result = await pipe.transform(input, {
      type: 'body',
      metatype: Object,
    });

    expect(result).toBe(input);
  });

  it('honors native pipe options such as transform: false', async () => {
    const pipe = new SchemaClassValidationPipe({
      transform: false,
    });
    const input = {
      name: '  Keyboard  ',
      price: '49.90',
    };

    const result = await pipe.transform(input, bodyMetadata);

    expect(result).toBe(input);
  });

  it('supports asynchronous, non-Zod Standard Schema implementations', async () => {
    const pipe = new SchemaClassValidationPipe();

    const result = await pipe.transform(
      { value: '42' },
      {
        type: 'body',
        metatype: AsyncVendorNeutralInput,
      },
    );

    expect(result).toEqual({ value: 42 });
  });
  it('passes the resolved parameter metadata to a custom exception factory', async () => {
    const exceptionFactory = vi.fn(
      (
        _issues: readonly StandardSchemaV1.Issue[],
        _metadata: ArgumentMetadata,
      ) => new BadRequestException('custom'),
    );
    const pipe = new SchemaClassValidationPipe({ exceptionFactory });

    await expect(
      pipe.transform({ name: '', price: 1 }, bodyMetadata),
    ).rejects.toThrow('custom');
    expect(exceptionFactory).toHaveBeenCalledWith(
      [expect.objectContaining({ path: ['name'] })],
      { ...bodyMetadata, schema: CreateProductSchema },
    );
  });

  it('keeps single-argument native exception factories working', async () => {
    const pipe = new SchemaClassValidationPipe({
      exceptionFactory: (issues) =>
        new BadRequestException(`${issues.length} issue(s)`),
    });

    await expect(
      pipe.transform({ name: '', price: -1 }, bodyMetadata),
    ).rejects.toThrow('2 issue(s)');
  });

  it('throws RFC 9457 validation problems with problemDetails', async () => {
    const pipe = new SchemaClassValidationPipe({
      problemDetails: { typeBaseUri: 'https://example.com/problems/' },
    });

    const error: unknown = await pipe
      .transform(
        { name: '', price: 1, extra: true },
        {
          type: 'query',
          metatype: Object,
          schema: CreateProductSchema.strict(),
        },
      )
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ValidationProblemException);
    expect((error as ValidationProblemException).getResponse()).toEqual({
      type: 'https://example.com/problems/validation-failed',
      title: 'Request validation failed',
      status: 400,
      detail: '2 validation errors in the query string.',
      errors: [
        {
          in: 'query',
          pointer: '/name',
          code: 'too_small',
          message: expect.any(String),
        },
        {
          in: 'query',
          pointer: '/extra',
          code: 'unrecognized_keys',
          message: 'Unrecognized key: "extra"',
        },
      ],
    });
  });

  it('uses errorHttpStatusCode as the default problem status', async () => {
    const pipe = new SchemaClassValidationPipe({
      errorHttpStatusCode: 422,
      problemDetails: true,
    });

    const error: unknown = await pipe
      .transform({ name: '', price: 1 }, bodyMetadata)
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ValidationProblemException);
    expect((error as ValidationProblemException).getStatus()).toBe(422);
    expect((error as ValidationProblemException).problem.status).toBe(422);
  });

  it('rejects combining exceptionFactory with problemDetails', () => {
    expect(
      () =>
        new SchemaClassValidationPipe({
          exceptionFactory: () => new BadRequestException(),
          problemDetails: true,
        }),
    ).toThrow(TypeError);
  });
});
