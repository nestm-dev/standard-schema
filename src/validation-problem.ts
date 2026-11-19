import {
  HttpException,
  HttpStatus,
  type ArgumentMetadata,
} from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/** The media type of an RFC 9457 problem document. */
export const PROBLEM_JSON_MEDIA_TYPE = 'application/problem+json';

/** Where an invalid value was found in the request. */
export type ValidationProblemLocation = 'body' | 'query' | 'path' | 'header';

/** One entry of a validation problem's `errors` member. */
export interface ValidationProblemError {
  /**
   * The request part holding the invalid value. Omitted for custom parameter
   * decorators unless `location` maps them.
   */
  readonly in?: ValidationProblemLocation;
  /**
   * RFC 6901 JSON Pointer to the invalid value within that request part. The
   * empty string points at the whole part.
   */
  readonly pointer: string;
  /** The schema library's issue code, or `invalid` when it has none. */
  readonly code: string;
  readonly message: string;
}

/** An RFC 9457 problem document describing failed request validation. */
export interface ValidationProblem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly errors: readonly ValidationProblemError[];
}

export interface ValidationProblemOptions {
  /**
   * Prefixed verbatim to `typeSlug` to form the problem `type`, for example
   * `https://example.com/problems/`. Without it, `type` is the bare slug, a
   * relative URI reference.
   */
  readonly typeBaseUri?: string;
  /** Problem type slug. Defaults to `validation-failed`. */
  readonly typeSlug?: string;
  /** Defaults to `Request validation failed`. */
  readonly title?: string;
  /** Defaults to 400. */
  readonly status?: number;
  /** Replaces the default summary, such as `2 validation errors in the request body.` */
  readonly detail?:
    | string
    | ((
        errors: readonly ValidationProblemError[],
        metadata: ArgumentMetadata,
      ) => string);
  /** The most `errors` entries to include. Defaults to 100. */
  readonly maxErrors?: number;
  /**
   * Maps a parameter to its request part. By default `@Body()` is `body`,
   * `@Query()` is `query`, `@Param()` is `path`, and custom decorators have
   * no location.
   */
  readonly location?: (
    metadata: ArgumentMetadata,
  ) => ValidationProblemLocation | undefined;
}

/**
 * An exception factory for request validation. Unlike Nest's own
 * `exceptionFactory`, it also receives the metadata of the parameter that
 * failed validation.
 */
export type SchemaValidationExceptionFactory = (
  issues: readonly StandardSchemaV1.Issue[],
  metadata: ArgumentMetadata,
) => unknown;

/**
 * An HTTP exception whose response body is an RFC 9457 validation problem.
 *
 * Nest's default exception filter sends that body as `application/json`.
 * `ValidationProblemFilter` sends it as `application/problem+json`.
 */
export class ValidationProblemException extends HttpException {
  constructor(readonly problem: ValidationProblem) {
    super(problem, problem.status);
  }

  override getResponse(): ValidationProblem {
    return this.problem;
  }
}

/**
 * Creates an exception factory that turns Standard Schema issues into an
 * RFC 9457 validation problem, with one `errors` entry per issue and one per
 * unrecognized key.
 */
export function createValidationProblemFactory(
  options: ValidationProblemOptions = {},
): (
  issues: readonly StandardSchemaV1.Issue[],
  metadata: ArgumentMetadata,
) => ValidationProblemException {
  const type = `${options.typeBaseUri ?? ''}${options.typeSlug ?? 'validation-failed'}`;
  const title = options.title ?? 'Request validation failed';
  const status = options.status ?? HttpStatus.BAD_REQUEST;
  const maxErrors = options.maxErrors ?? 100;
  const resolveLocation = options.location ?? getDefaultLocation;

  return (issues, metadata) => {
    const location = resolveLocation(metadata);
    const basePath =
      typeof metadata.data === 'string' && metadata.data !== ''
        ? [metadata.data]
        : [];
    const errors = issues.flatMap((issue) =>
      toProblemErrors(issue, location, basePath),
    );
    const detail =
      typeof options.detail === 'function'
        ? options.detail(errors, metadata)
        : (options.detail ?? describeErrors(errors.length, location));

    return new ValidationProblemException({
      type,
      title,
      status,
      detail,
      errors: errors.slice(0, maxErrors),
    });
  };
}

/**
 * Formats a Standard Schema issue path as an RFC 6901 JSON Pointer, escaping
 * `~` as `~0` and `/` as `~1`. An empty path is the empty pointer.
 */
export function toJsonPointer(
  path: readonly (PropertyKey | StandardSchemaV1.PathSegment)[] = [],
): string {
  return path
    .map((segment) => {
      const key = typeof segment === 'object' ? segment.key : segment;

      return `/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`;
    })
    .join('');
}

function toProblemErrors(
  issue: StandardSchemaV1.Issue,
  location: ValidationProblemLocation | undefined,
  basePath: readonly PropertyKey[],
): ValidationProblemError[] {
  const path = [...basePath, ...(issue.path ?? [])];
  const code = getIssueCode(issue);
  const where = location === undefined ? {} : { in: location };
  const unrecognizedKeys = getUnrecognizedKeys(issue);

  if (unrecognizedKeys !== undefined) {
    return unrecognizedKeys.map((key) => ({
      ...where,
      pointer: toJsonPointer([...path, key]),
      code,
      message: `Unrecognized key: "${key}"`,
    }));
  }

  return [
    {
      ...where,
      pointer: toJsonPointer(path),
      code,
      message: issue.message,
    },
  ];
}

function getIssueCode(issue: StandardSchemaV1.Issue): string {
  const { code, type } = issue as { code?: unknown; type?: unknown };

  if (typeof code === 'string' && code !== '') {
    return code;
  }

  // Valibot names its issues by `type` instead of `code`.
  if (typeof type === 'string' && type !== '') {
    return type;
  }

  return 'invalid';
}

/** Zod reports every unknown key of an object in one `unrecognized_keys` issue. */
function getUnrecognizedKeys(
  issue: StandardSchemaV1.Issue,
): readonly string[] | undefined {
  const { code, keys } = issue as { code?: unknown; keys?: unknown };

  if (code !== 'unrecognized_keys' || !Array.isArray(keys)) {
    return undefined;
  }

  const names = keys.filter((key): key is string => typeof key === 'string');

  return names.length > 0 ? names : undefined;
}

function getDefaultLocation(
  metadata: ArgumentMetadata,
): ValidationProblemLocation | undefined {
  switch (metadata.type) {
    case 'body':
      return 'body';
    case 'query':
      return 'query';
    case 'param':
      return 'path';
    default:
      return undefined;
  }
}

const LOCATION_NAMES: Record<ValidationProblemLocation, string> = {
  body: 'request body',
  query: 'query string',
  path: 'path parameters',
  header: 'request headers',
};

function describeErrors(
  count: number,
  location: ValidationProblemLocation | undefined,
): string {
  const subject = location === undefined ? 'request' : LOCATION_NAMES[location];
  const noun = count === 1 ? 'error' : 'errors';

  return `${count} validation ${noun} in the ${subject}.`;
}
