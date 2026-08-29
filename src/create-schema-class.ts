import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
  isStandardSchema,
  STANDARD_SCHEMA_CLASS,
  type SchemaClass,
} from './schema.js';

/**
 * Creates a runtime class backed by a Standard Schema.
 *
 * The returned class is itself a Standard Schema and its instance type is the
 * schema's parsed object output. Extending it gives Nest a concrete metatype
 * from which the schema-class validation pipe can discover the schema.
 */
export function createSchemaClass<
  const Schema extends StandardSchemaV1<unknown, object>,
>(schema: Schema): SchemaClass<Schema> {
  if (!isStandardSchema(schema)) {
    throw new TypeError('createSchemaClass() expected a Standard Schema.');
  }

  class GeneratedSchemaClass {
    static readonly ['~standard'] = schema['~standard'];
    static readonly [STANDARD_SCHEMA_CLASS] = true as const;
    static readonly schema = schema;
  }

  return GeneratedSchemaClass as unknown as SchemaClass<Schema>;
}
