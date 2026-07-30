import type { StandardSchemaV1 } from '@standard-schema/spec';

export const STANDARD_SCHEMA_DTO = Symbol.for('@nestm/standard-schema/dto');
export const STANDARD_SCHEMA_RESPONSE_DTO = Symbol.for(
  '@nestm/standard-schema/response-dto',
);

/**
 * Runtime class created by `createStandardSchemaDto`.
 *
 * Its instance type is the schema's parsed object output.
 */
export interface StandardSchemaDtoClass<
  Schema extends StandardSchemaV1<unknown, object> = StandardSchemaV1<
    unknown,
    object
  >,
> {
  new (): StandardSchemaV1.InferOutput<Schema>;
  readonly [STANDARD_SCHEMA_DTO]: true;
  readonly schema: Schema;
}

/**
 * Runtime class created by `createStandardSchemaResponseDto`.
 *
 * Its instance type is the value accepted from the response handler, before
 * the schema parses it into the serialized HTTP output.
 */
export interface StandardSchemaResponseDtoClass<
  Schema extends StandardSchemaV1<object, unknown> = StandardSchemaV1<
    object,
    unknown
  >,
> {
  new (): StandardSchemaV1.InferInput<Schema>;
  readonly [STANDARD_SCHEMA_RESPONSE_DTO]: true;
  readonly schema: Schema;
}

export type StandardSchemaSource =
  StandardSchemaV1 | StandardSchemaDtoClass | StandardSchemaResponseDtoClass;

/** Returns whether a value implements Standard Schema V1. */
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (!isObjectLike(value)) {
    return false;
  }

  const standard = value['~standard'];

  return (
    isObjectLike(standard) &&
    standard.version === 1 &&
    typeof standard.validate === 'function'
  );
}

/** Returns whether a value is a branded Standard Schema DTO class. */
export function isStandardSchemaDto(
  value: unknown,
): value is StandardSchemaDtoClass {
  if (typeof value !== 'function') {
    return false;
  }

  const candidate = value as unknown as {
    readonly [STANDARD_SCHEMA_DTO]?: unknown;
    readonly schema?: unknown;
  };

  return (
    candidate[STANDARD_SCHEMA_DTO] === true &&
    isStandardSchema(candidate.schema)
  );
}

/** Returns whether a value is a branded Standard Schema response DTO class. */
export function isStandardSchemaResponseDto(
  value: unknown,
): value is StandardSchemaResponseDtoClass {
  if (typeof value !== 'function') {
    return false;
  }

  const candidate = value as unknown as {
    readonly [STANDARD_SCHEMA_RESPONSE_DTO]?: unknown;
    readonly schema?: unknown;
  };

  return (
    candidate[STANDARD_SCHEMA_RESPONSE_DTO] === true &&
    isStandardSchema(candidate.schema)
  );
}

/** Resolves a raw Standard Schema or the schema carried by a generated DTO. */
export function getStandardSchema<
  Schema extends StandardSchemaV1<unknown, object>,
>(source: StandardSchemaDtoClass<Schema>): Schema;
export function getStandardSchema<
  Schema extends StandardSchemaV1<object, unknown>,
>(source: StandardSchemaResponseDtoClass<Schema>): Schema;
export function getStandardSchema<Schema extends StandardSchemaV1>(
  source: Schema,
): Schema;
export function getStandardSchema(
  source: StandardSchemaSource,
): StandardSchemaV1;
export function getStandardSchema(
  source: StandardSchemaSource,
): StandardSchemaV1 {
  if (isStandardSchemaDto(source) || isStandardSchemaResponseDto(source)) {
    return source.schema;
  }

  if (isStandardSchema(source)) {
    return source;
  }

  throw new TypeError(
    'Expected a Standard Schema or a class created by a Standard Schema DTO factory.',
  );
}

function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  );
}
