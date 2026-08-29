import { applyDecorators } from '@nestjs/common';
import { ApiResponse, type ApiResponseMetadata } from '@nestjs/swagger';

import {
  StandardSchemaResponse,
  type StandardSchemaResponseOptions,
} from '../standard-schema-response.decorator.js';
import { getStandardSchema, type StandardSchemaSource } from '../schema.js';

type DistributiveOmit<T, Keys extends PropertyKey> = T extends unknown
  ? Omit<T, Keys>
  : never;

export type ApiStandardSchemaResponseOptions = DistributiveOmit<
  ApiResponseMetadata,
  'standardSchema' | 'type'
> &
  StandardSchemaResponseOptions;

/**
 * Combines Nest's native Standard Schema response serialization with
 * `@nestjs/swagger` response metadata.
 */
export function ApiStandardSchemaResponse(
  source: StandardSchemaSource,
  options: ApiStandardSchemaResponseOptions = {},
): ClassDecorator & MethodDecorator {
  const { validateOptions, ...responseOptions } = options;
  const serializationOptions =
    validateOptions === undefined ? {} : { validateOptions };

  return applyDecorators(
    StandardSchemaResponse(source, serializationOptions),
    ApiResponse({
      ...responseOptions,
      standardSchema: getStandardSchema(source),
    }),
  );
}
