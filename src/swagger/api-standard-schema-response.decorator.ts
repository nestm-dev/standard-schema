import { applyDecorators } from '@nestjs/common';
import {
  ApiResponse,
  type ApiResponseMetadata,
  type StandardSchemaConverter,
} from '@nestjs/swagger';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
  StandardSchemaResponse,
  type StandardSchemaResponseOptions,
} from '../standard-schema-response.decorator.js';
import { getStandardSchema, type StandardSchemaSource } from '../schema.js';

const ARRAY_ITEM_STANDARD_SCHEMA = Symbol.for(
  '@nestm/standard-schema:swagger-array-item',
);

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

/**
 * Unwraps array metadata emitted by prerelease versions of this package before
 * delegating to a custom Nest Swagger Standard Schema converter.
 *
 * @deprecated Nest Swagger 12 stable applies `isArray` after custom Standard
 * Schema conversion without an adapter.
 */
export function withStandardSchemaResponseArrays(
  converter: StandardSchemaConverter,
): StandardSchemaConverter {
  return (schema, options) => {
    if (!isArrayStandardSchema(schema)) {
      return converter(schema, options);
    }

    return converter(schema[ARRAY_ITEM_STANDARD_SCHEMA], options);
  };
}

type ArrayStandardSchemaMarker = {
  readonly [ARRAY_ITEM_STANDARD_SCHEMA]: StandardSchemaV1;
};

function isArrayStandardSchema(
  value: unknown,
): value is ArrayStandardSchemaMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    ARRAY_ITEM_STANDARD_SCHEMA in value &&
    isStandardSchemaValue(value[ARRAY_ITEM_STANDARD_SCHEMA])
  );
}

function isStandardSchemaValue(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    '~standard' in value &&
    typeof value['~standard'] === 'object' &&
    value['~standard'] !== null
  );
}
