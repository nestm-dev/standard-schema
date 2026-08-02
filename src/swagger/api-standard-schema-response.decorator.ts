import { applyDecorators } from '@nestjs/common';
import {
  ApiResponse,
  type ApiResponseMetadata,
  type StandardSchemaConverter,
} from '@nestjs/swagger';
import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from '@standard-schema/spec';

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
      standardSchema: getSwaggerResponseSchema(
        getStandardSchema(source),
        responseOptions.isArray === true,
      ),
    }),
  );
}

/**
 * Wraps a custom Nest Swagger Standard Schema converter so response schemas
 * declared with `isArray: true` retain their array shape.
 */
export function withStandardSchemaResponseArrays(
  converter: StandardSchemaConverter,
): StandardSchemaConverter {
  return (schema, options) => {
    if (!isArrayStandardSchema(schema)) {
      return converter(schema, options);
    }

    const converted = converter(schema[ARRAY_ITEM_STANDARD_SCHEMA], options);

    if (converted === undefined) {
      return undefined;
    }

    return {
      ...converted,
      schema: {
        items: converted.schema,
        type: 'array',
      },
    };
  };
}

function getSwaggerResponseSchema(
  schema: StandardSchemaV1,
  isArray: boolean,
): StandardJSONSchemaV1 | StandardSchemaV1 {
  const standard = schema['~standard'];

  if (!isArray) {
    return schema;
  }

  if (!hasJsonSchemaConverter(standard)) {
    const arraySchema: ArrayStandardSchema = {
      [ARRAY_ITEM_STANDARD_SCHEMA]: schema,
      '~standard': standard,
    };

    return arraySchema;
  }

  const arraySchema: ArrayStandardJsonSchema = {
    [ARRAY_ITEM_STANDARD_SCHEMA]: schema,
    '~standard': {
      jsonSchema: {
        input: (options: StandardJSONSchemaV1.Options) =>
          wrapArrayJsonSchema(standard.jsonSchema.input(options)),
        output: (options: StandardJSONSchemaV1.Options) =>
          wrapArrayJsonSchema(standard.jsonSchema.output(options)),
      },
      vendor: standard.vendor,
      version: 1,
    },
  };

  return arraySchema;
}

type ArrayStandardSchemaMarker = {
  readonly [ARRAY_ITEM_STANDARD_SCHEMA]: StandardSchemaV1;
};

type ArrayStandardSchema = StandardSchemaV1 & ArrayStandardSchemaMarker;

type ArrayStandardJsonSchema = StandardJSONSchemaV1 & ArrayStandardSchemaMarker;

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

function hasJsonSchemaConverter(
  standard: StandardSchemaV1.Props,
): standard is StandardSchemaV1.Props & {
  readonly jsonSchema: StandardJSONSchemaV1.Converter;
} {
  if (!('jsonSchema' in standard)) {
    return false;
  }

  const jsonSchema = (
    standard as StandardSchemaV1.Props & {
      readonly jsonSchema?: unknown;
    }
  ).jsonSchema;
  const converter = jsonSchema as
    Partial<StandardJSONSchemaV1.Converter> | undefined;

  return (
    converter !== undefined &&
    converter !== null &&
    typeof converter.input === 'function' &&
    typeof converter.output === 'function'
  );
}

function wrapArrayJsonSchema(
  converted: Record<string, unknown>,
): Record<string, unknown> {
  const rootEntries: Array<readonly [string, unknown]> = [];
  const itemEntries: Array<readonly [string, unknown]> = [];

  for (const entry of Object.entries(converted)) {
    if (
      entry[0] === '$defs' ||
      entry[0] === '$schema' ||
      entry[0] === 'definitions'
    ) {
      rootEntries.push(entry);
    } else {
      itemEntries.push(entry);
    }
  }

  return {
    ...Object.fromEntries(rootEntries),
    items: Object.fromEntries(itemEntries),
    type: 'array',
  };
}
