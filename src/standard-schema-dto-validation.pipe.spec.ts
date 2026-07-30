import { BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

import { createStandardSchemaDto } from './create-standard-schema-dto.js';
import { StandardSchemaDtoValidationPipe } from './standard-schema-dto-validation.pipe.js';

const CreateProductSchema = z.object({
  name: z.string().trim().min(1),
  price: z.coerce.number().nonnegative(),
  active: z.boolean().default(true),
});

class CreateProductDto extends createStandardSchemaDto(CreateProductSchema) {}

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

class AsyncVendorNeutralDto extends createStandardSchemaDto(
  AsyncVendorNeutralSchema,
) {}

const bodyMetadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateProductDto,
};

describe(StandardSchemaDtoValidationPipe.name, () => {
  it('infers the DTO schema and returns Nest native parsed output', async () => {
    const pipe = new StandardSchemaDtoValidationPipe();

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
    const pipe = new StandardSchemaDtoValidationPipe();
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
    const pipe = new StandardSchemaDtoValidationPipe();

    await expect(
      pipe.transform({ name: '', price: -1 }, bodyMetadata),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('passes values without an explicit or DTO-carried schema through', async () => {
    const pipe = new StandardSchemaDtoValidationPipe();
    const input = { untouched: true };

    const result = await pipe.transform(input, {
      type: 'body',
      metatype: Object,
    });

    expect(result).toBe(input);
  });

  it('honors native pipe options such as transform: false', async () => {
    const pipe = new StandardSchemaDtoValidationPipe({
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
    const pipe = new StandardSchemaDtoValidationPipe();

    const result = await pipe.transform(
      { value: '42' },
      {
        type: 'body',
        metatype: AsyncVendorNeutralDto,
      },
    );

    expect(result).toEqual({ value: 42 });
  });
});
