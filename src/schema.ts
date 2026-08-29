import type { StandardSchemaV1 } from '@standard-schema/spec';

export const STANDARD_SCHEMA_CLASS = Symbol.for('@nestm/standard-schema/class');
export const STANDARD_SCHEMA_RESPONSE_CLASS = Symbol.for(
  '@nestm/standard-schema/response-class',
);

/**
 * Runtime class backed by a Standard Schema.
 *
 * The class value is itself a Standard Schema, while its instance type is the
 * parsed schema output received by a request handler.
 */
export interface SchemaClass<
  Schema extends StandardSchemaV1<unknown, object> = StandardSchemaV1<
    unknown,
    object
  >,
> extends StandardSchemaV1<
  StandardSchemaV1.InferInput<Schema>,
  StandardSchemaV1.InferOutput<Schema>
> {
  new (): StandardSchemaV1.InferOutput<Schema>;
  readonly [STANDARD_SCHEMA_CLASS]: true;
  readonly schema: Schema;
}

/**
 * Runtime class backed by a response Standard Schema.
 *
 * The class value is itself a Standard Schema, while its instance type is the
 * value accepted from a response handler before serialization.
 */
export interface ResponseSchemaClass<
  Schema extends StandardSchemaV1<object, unknown> = StandardSchemaV1<
    object,
    unknown
  >,
> extends StandardSchemaV1<
  StandardSchemaV1.InferInput<Schema>,
  StandardSchemaV1.InferOutput<Schema>
> {
  new (): StandardSchemaV1.InferInput<Schema>;
  readonly [STANDARD_SCHEMA_RESPONSE_CLASS]: true;
  readonly schema: Schema;
}

export type StandardSchemaSource =
  StandardSchemaV1 | SchemaClass | ResponseSchemaClass;

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

export function isSchemaClass(value: unknown): value is SchemaClass {
  if (typeof value !== 'function') {
    return false;
  }

  const candidate = value as unknown as {
    readonly [STANDARD_SCHEMA_CLASS]?: unknown;
    readonly schema?: unknown;
  };

  return (
    candidate[STANDARD_SCHEMA_CLASS] === true &&
    isStandardSchema(candidate.schema)
  );
}

export function isResponseSchemaClass(
  value: unknown,
): value is ResponseSchemaClass {
  if (typeof value !== 'function') {
    return false;
  }

  const candidate = value as unknown as {
    readonly [STANDARD_SCHEMA_RESPONSE_CLASS]?: unknown;
    readonly schema?: unknown;
  };

  return (
    candidate[STANDARD_SCHEMA_RESPONSE_CLASS] === true &&
    isStandardSchema(candidate.schema)
  );
}

export function getStandardSchema<
  Schema extends StandardSchemaV1<unknown, object>,
>(source: SchemaClass<Schema>): Schema;
export function getStandardSchema<
  Schema extends StandardSchemaV1<object, unknown>,
>(source: ResponseSchemaClass<Schema>): Schema;
export function getStandardSchema<Schema extends StandardSchemaV1>(
  source: Schema,
): Schema;
export function getStandardSchema(
  source: StandardSchemaSource,
): StandardSchemaV1;
export function getStandardSchema(
  source: StandardSchemaSource,
): StandardSchemaV1 {
  if (isSchemaClass(source) || isResponseSchemaClass(source)) {
    return source.schema;
  }

  if (isStandardSchema(source)) {
    return source;
  }

  throw new TypeError('Expected a Standard Schema or schema class.');
}

function isObjectLike(value: unknown): value is Record<PropertyKey, unknown> {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  );
}
