import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
  isStandardSchema,
  STANDARD_SCHEMA_RESPONSE_CLASS,
  type ResponseSchemaClass,
} from './schema.js';

/**
 * Creates a runtime response class backed by a Standard Schema.
 *
 * The returned class is itself a Standard Schema and its instance type is the
 * schema input accepted from a response handler. Nest's serializer parses that
 * value into the schema output sent to the client.
 */
export function createResponseSchemaClass<
  const Schema extends StandardSchemaV1<object, unknown>,
>(schema: Schema): ResponseSchemaClass<Schema> {
  if (!isStandardSchema(schema)) {
    throw new TypeError(
      'createResponseSchemaClass() expected a Standard Schema.',
    );
  }

  class GeneratedResponseSchemaClass {
    static readonly ['~standard'] = schema['~standard'];
    static readonly [STANDARD_SCHEMA_RESPONSE_CLASS] = true as const;
    static readonly schema = schema;
  }

  return GeneratedResponseSchemaClass as unknown as ResponseSchemaClass<Schema>;
}
