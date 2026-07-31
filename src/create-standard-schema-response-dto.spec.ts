import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

import { createStandardSchemaDto } from './create-standard-schema-dto.js';
import { createStandardSchemaResponseDto } from './create-standard-schema-response-dto.js';
import {
  getStandardSchema,
  isStandardSchemaDto,
  isStandardSchemaResponseDto,
  STANDARD_SCHEMA_RESPONSE_DTO,
  type StandardSchemaResponseDtoClass,
  type StandardSchemaSource,
} from './schema.js';

const TransformingSchema = z.object({
  name: z.string().trim(),
  publishedAt: z.date().transform((value) => value.toISOString()),
});

class RequestDto extends createStandardSchemaDto(TransformingSchema) {}

class ResponseDto extends createStandardSchemaResponseDto(TransformingSchema) {}

describe(createStandardSchemaResponseDto.name, () => {
  it('carries the original schema on a response-branded runtime class', () => {
    expect(ResponseDto.schema).toBe(TransformingSchema);
    expect(ResponseDto[STANDARD_SCHEMA_RESPONSE_DTO]).toBe(true);
    expect(isStandardSchemaResponseDto(ResponseDto)).toBe(true);
    expect(isStandardSchemaDto(ResponseDto)).toBe(false);
  });

  it('uses schema input for responses while request DTOs keep schema output', () => {
    expectTypeOf<ResponseDto>().toEqualTypeOf<{
      name: string;
      publishedAt: Date;
    }>();
    expectTypeOf<
      StandardSchemaV1.InferOutput<typeof ResponseDto.schema>
    >().toEqualTypeOf<{
      name: string;
      publishedAt: string;
    }>();
    expectTypeOf<RequestDto>().toEqualTypeOf<{
      name: string;
      publishedAt: string;
    }>();
    expectTypeOf(ResponseDto).toMatchTypeOf<
      StandardSchemaResponseDtoClass<typeof TransformingSchema>
    >();
  });

  it('resolves the carried response schema', () => {
    expect(getStandardSchema(ResponseDto)).toBe(TransformingSchema);
    expectTypeOf(getStandardSchema(ResponseDto)).toEqualTypeOf<
      typeof TransformingSchema
    >();
  });

  it('rejects unbranded response schema carriers', () => {
    class UnbrandedResponseDto {
      static readonly schema = TransformingSchema;
    }

    expect(isStandardSchemaResponseDto(UnbrandedResponseDto)).toBe(false);
    expect(() =>
      getStandardSchema(
        UnbrandedResponseDto as unknown as StandardSchemaSource,
      ),
    ).toThrow(TypeError);
  });

  it('rejects invalid schemas passed from untyped JavaScript', () => {
    expect(() =>
      createStandardSchemaResponseDto(
        {} as unknown as typeof TransformingSchema,
      ),
    ).toThrow(TypeError);
  });
});
