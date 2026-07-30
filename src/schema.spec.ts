import { z } from 'zod';

import { createStandardSchemaDto } from './create-standard-schema-dto.js';
import {
  getStandardSchema,
  isStandardSchema,
  isStandardSchemaDto,
  STANDARD_SCHEMA_DTO,
  type StandardSchemaSource,
} from './schema.js';

const ExampleSchema = z.object({
  name: z.string().trim(),
  quantity: z.coerce.number().int(),
});

class ExampleDto extends createStandardSchemaDto(ExampleSchema) {}

describe('Standard Schema DTO carrier', () => {
  it('carries the original schema on a branded runtime class', () => {
    expect(ExampleDto.schema).toBe(ExampleSchema);
    expect(ExampleDto[STANDARD_SCHEMA_DTO]).toBe(true);
    expect(isStandardSchemaDto(ExampleDto)).toBe(true);
  });

  it('preserves the schema output as the DTO instance type', () => {
    expectTypeOf<ExampleDto>().toEqualTypeOf<{
      name: string;
      quantity: number;
    }>();
  });

  it('recognizes Standard Schema implementations', () => {
    expect(isStandardSchema(ExampleSchema)).toBe(true);
    expect(isStandardSchema({})).toBe(false);
    expect(isStandardSchema(null)).toBe(false);
  });

  it('resolves either a DTO class or a schema', () => {
    expect(getStandardSchema(ExampleDto)).toBe(ExampleSchema);
    expect(getStandardSchema(ExampleSchema)).toBe(ExampleSchema);
    expectTypeOf(getStandardSchema(ExampleDto)).toEqualTypeOf<
      typeof ExampleSchema
    >();
    expectTypeOf(getStandardSchema(ExampleSchema)).toEqualTypeOf<
      typeof ExampleSchema
    >();
  });

  it('rejects unbranded schema-like classes', () => {
    class UnbrandedDto {
      static readonly schema = ExampleSchema;
    }

    expect(isStandardSchemaDto(UnbrandedDto)).toBe(false);
    expect(() =>
      getStandardSchema(UnbrandedDto as unknown as StandardSchemaSource),
    ).toThrow(TypeError);
  });

  it('rejects invalid schemas passed from untyped JavaScript', () => {
    expect(() =>
      createStandardSchemaDto({} as unknown as typeof ExampleSchema),
    ).toThrow(TypeError);
  });
});
