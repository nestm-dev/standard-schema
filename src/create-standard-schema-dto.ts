import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
  isStandardSchema,
  STANDARD_SCHEMA_DTO,
  type StandardSchemaDtoClass,
} from './schema.js';

/**
 * Creates a runtime DTO base class whose instance type is the schema's parsed
 * object output.
 *
 * Nest reflects a concrete subclass at runtime, allowing the DTO-aware pipe to
 * discover the schema from `@Body()`, `@Query()`, or whole-object `@Param()`
 * metadata.
 */
export function createStandardSchemaDto<
  const Schema extends StandardSchemaV1<unknown, object>,
>(schema: Schema): StandardSchemaDtoClass<Schema> {
  if (!isStandardSchema(schema)) {
    throw new TypeError(
      'createStandardSchemaDto() expected a Standard Schema.',
    );
  }

  class StandardSchemaDto {
    static readonly [STANDARD_SCHEMA_DTO] = true as const;
    static readonly schema = schema;
  }

  return StandardSchemaDto as unknown as StandardSchemaDtoClass<Schema>;
}
