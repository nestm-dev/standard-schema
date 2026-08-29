import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

import { createSchemaClass } from './create-schema-class.js';
import { SchemaClassValidationPipe } from './schema-class-validation.pipe.js';

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
});
