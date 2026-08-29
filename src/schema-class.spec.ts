import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

import { createResponseSchemaClass } from './create-response-schema-class.js';
import { createSchemaClass } from './create-schema-class.js';
import {
  getStandardSchema,
  isResponseSchemaClass,
  isSchemaClass,
  isStandardSchema,
  type ResponseSchemaClass,
  type SchemaClass,
} from './schema.js';

const TransformingSchema = z.object({
  name: z.string().trim(),
  publishedAt: z.date().transform((value) => value.toISOString()),
});

class ParsedProduct extends createSchemaClass(TransformingSchema) {}

class ProductResponse extends createResponseSchemaClass(TransformingSchema) {}

describe('schema classes', () => {
  it('makes a request class a Standard Schema while preserving its source', () => {
    expect(isStandardSchema(ParsedProduct)).toBe(true);
    expect(isSchemaClass(ParsedProduct)).toBe(true);
    expect(isResponseSchemaClass(ParsedProduct)).toBe(false);
    expect(ParsedProduct.schema).toBe(TransformingSchema);
    expect(ParsedProduct['~standard']).toBe(TransformingSchema['~standard']);
    expect(getStandardSchema(ParsedProduct)).toBe(TransformingSchema);
    expectTypeOf(ParsedProduct).toMatchTypeOf<StandardSchemaV1>();
    expectTypeOf(ParsedProduct).toMatchTypeOf<
      SchemaClass<typeof TransformingSchema>
    >();
  });

  it('uses schema output as the request class instance type', () => {
    expectTypeOf<ParsedProduct>().toEqualTypeOf<{
      name: string;
      publishedAt: string;
    }>();
  });

  it('uses schema input as the response class instance type', () => {
    expect(isStandardSchema(ProductResponse)).toBe(true);
    expect(isSchemaClass(ProductResponse)).toBe(false);
    expect(isResponseSchemaClass(ProductResponse)).toBe(true);
    expect(ProductResponse.schema).toBe(TransformingSchema);
    expect(getStandardSchema(ProductResponse)).toBe(TransformingSchema);
    expectTypeOf<ProductResponse>().toEqualTypeOf<{
      name: string;
      publishedAt: Date;
    }>();
    expectTypeOf(ProductResponse).toMatchTypeOf<
      ResponseSchemaClass<typeof TransformingSchema>
    >();
    expectTypeOf<
      StandardSchemaV1.InferOutput<typeof ProductResponse>
    >().toEqualTypeOf<{
      name: string;
      publishedAt: string;
    }>();
  });

  it('accepts raw Standard Schemas without wrapping them', () => {
    expect(getStandardSchema(TransformingSchema)).toBe(TransformingSchema);
    expectTypeOf(getStandardSchema(TransformingSchema)).toEqualTypeOf<
      typeof TransformingSchema
    >();
  });

  it('rejects invalid schemas passed from untyped JavaScript', () => {
    expect(() =>
      createSchemaClass({} as unknown as typeof TransformingSchema),
    ).toThrow(TypeError);
    expect(() =>
      createResponseSchemaClass({} as unknown as typeof TransformingSchema),
    ).toThrow(TypeError);
  });

  it('rejects unrelated classes and values', () => {
    class UnrelatedClass {}

    expect(isStandardSchema(UnrelatedClass)).toBe(false);
    expect(isStandardSchema({})).toBe(false);
    expect(isStandardSchema(null)).toBe(false);
    expect(() =>
      getStandardSchema(UnrelatedClass as unknown as typeof TransformingSchema),
    ).toThrow(TypeError);
  });
});
