import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
  isStandardSchema,
  STANDARD_SCHEMA_RESPONSE_DTO,
  type StandardSchemaResponseDtoClass,
} from './schema.js';

/**
 * Creates a runtime DTO base class whose instance type is the schema's input.
 *
 * A response handler returns the schema input, while Nest's native serializer
 * validates that value and sends the schema output to the HTTP client.
 */
export function createStandardSchemaResponseDto<
  const Schema extends StandardSchemaV1<object, unknown>,
>(schema: Schema): StandardSchemaResponseDtoClass<Schema> {
  if (!isStandardSchema(schema)) {
    throw new TypeError(
      'createStandardSchemaResponseDto() expected a Standard Schema.',
    );
  }

  class StandardSchemaResponseDto {
    static readonly [STANDARD_SCHEMA_RESPONSE_DTO] = true as const;
    static readonly schema = schema;
  }

  return StandardSchemaResponseDto as unknown as StandardSchemaResponseDtoClass<Schema>;
}
