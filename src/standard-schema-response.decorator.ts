import { SerializeOptions } from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { getStandardSchema, type StandardSchemaSource } from './schema.js';

export interface StandardSchemaResponseOptions {
  validateOptions?: StandardSchemaV1.Options;
}

/**
 * Attaches a raw or DTO-carried schema through Nest's native
 * `@SerializeOptions({ schema })` metadata.
 */
export function StandardSchemaResponse(
  source: StandardSchemaSource,
  options: StandardSchemaResponseOptions = {},
): ClassDecorator & MethodDecorator {
  return SerializeOptions({
    ...options,
    schema: getStandardSchema(source),
  });
}
