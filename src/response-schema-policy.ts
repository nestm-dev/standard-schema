import {
  HttpStatus,
  RequestMethod,
  StreamableFile,
  type Type,
} from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import {
  CLASS_SERIALIZER_OPTIONS,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  NEXT_ROUTE_PARAMTYPE,
  PATH_METADATA,
  REDIRECT_METADATA,
  RENDER_METADATA,
  RESPONSE_PASSTHROUGH_METADATA,
  RESPONSE_ROUTE_PARAMTYPE,
  ROUTE_ARGS_METADATA,
  SSE_METADATA,
} from './nest-metadata.js';
import { SKIP_RESPONSE_SCHEMA } from './skip-response-schema.decorator.js';

/** An HTTP route reported by `serialization.requireResponseSchema`. */
export interface ResponseSchemaRoute {
  /** Controller class name. */
  readonly controller: string;
  /** Route handler method name. */
  readonly handler: string;
  /** HTTP method, such as `GET`. */
  readonly method: string;
  /** Route paths, without the global prefix or version. */
  readonly paths: readonly string[];
}

/**
 * Thrown when `serialization.requireResponseSchema` finds JSON routes without
 * a response schema: at application bootstrap for every such route, and at
 * request time for a route that returns a body anyway. A request-time
 * failure reaches the client as an opaque 500 response.
 */
export class MissingResponseSchemaError extends Error {
  override readonly name = 'MissingResponseSchemaError';

  constructor(readonly routes: readonly ResponseSchemaRoute[]) {
    super(formatMessage(routes));
  }
}

type RouteHandler = (...args: never[]) => unknown;

/**
 * Lists the JSON routes of the given controllers that have no response
 * schema and are not exempt.
 *
 * Routes are exempt when they use `@SkipResponseSchema()`, `@HttpCode(204)`,
 * `@Redirect()`, `@Render()`, `@Sse()`, a non-JSON `Content-Type` set through
 * `@Header()`, the `HEAD` method, or a synchronous `StreamableFile` return
 * type. `defaultSchema` is the serializer's module-wide schema, if any.
 */
export function findRoutesWithoutResponseSchema(
  controllers: Iterable<Type<unknown>>,
  defaultSchema?: StandardSchemaV1,
): ResponseSchemaRoute[] {
  const routes: ResponseSchemaRoute[] = [];

  for (const controller of new Set(controllers)) {
    for (const [name, handler] of getRouteHandlers(controller)) {
      if (
        hasResponseSchema(controller, handler, defaultSchema) ||
        isExemptFromResponseSchema(controller, handler) ||
        Reflect.getMetadata('design:returntype', controller.prototype, name) ===
          StreamableFile
      ) {
        continue;
      }

      routes.push(describeRoute(controller, handler, name));
    }
  }

  return routes;
}

/** Whether static route metadata exempts a handler from the requirement. */
export function isExemptFromResponseSchema(
  controller: Type<unknown>,
  handler: RouteHandler,
): boolean {
  if (
    Reflect.getMetadata(SKIP_RESPONSE_SCHEMA, handler) === true ||
    Reflect.getMetadata(SKIP_RESPONSE_SCHEMA, controller) === true ||
    Reflect.getMetadata(HTTP_CODE_METADATA, handler) ===
      HttpStatus.NO_CONTENT ||
    Reflect.getMetadata(METHOD_METADATA, handler) === RequestMethod.HEAD ||
    Reflect.hasMetadata(REDIRECT_METADATA, handler) ||
    Reflect.hasMetadata(RENDER_METADATA, handler) ||
    Reflect.getMetadata(SSE_METADATA, handler) === true
  ) {
    return true;
  }

  const headers: unknown = Reflect.getMetadata(HEADERS_METADATA, handler);

  return (
    Array.isArray(headers) &&
    headers.some(
      (header: { name?: unknown; value?: unknown }) =>
        typeof header.name === 'string' &&
        header.name.toLowerCase() === 'content-type' &&
        typeof header.value === 'string' &&
        !isJsonMediaType(header.value),
    )
  );
}

/**
 * Whether a handler writes its own response through `@Res()` or `@Next()`
 * without `passthrough`, in which case Nest ignores its return value.
 */
export function writesResponseDirectly(
  controller: Type<unknown>,
  handlerName: string,
): boolean {
  const args: unknown = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    controller,
    handlerName,
  );

  if (typeof args !== 'object' || args === null) {
    return false;
  }

  const usesResponse = Object.keys(args).some((key) => {
    const paramtype = Number(key.split(':')[0]);

    return (
      paramtype === RESPONSE_ROUTE_PARAMTYPE ||
      paramtype === NEXT_ROUTE_PARAMTYPE
    );
  });

  return (
    usesResponse &&
    Reflect.getMetadata(
      RESPONSE_PASSTHROUGH_METADATA,
      controller,
      handlerName,
    ) !== true
  );
}

export function describeRoute(
  controller: Type<unknown>,
  handler: RouteHandler,
  handlerName = handler.name,
): ResponseSchemaRoute {
  const method: unknown = Reflect.getMetadata(METHOD_METADATA, handler);
  const controllerPaths = toPaths(
    Reflect.getMetadata(PATH_METADATA, controller),
  );
  const handlerPaths = toPaths(Reflect.getMetadata(PATH_METADATA, handler));

  return {
    controller: controller.name,
    handler: handlerName,
    method:
      typeof method === 'number' ? (RequestMethod[method] ?? 'ALL') : 'ALL',
    paths: controllerPaths.flatMap((prefix) =>
      handlerPaths.map((path) => joinPaths(prefix, path)),
    ),
  };
}

function* getRouteHandlers(
  controller: Type<unknown>,
): Generator<[string, RouteHandler]> {
  const seen = new Set<string>();

  for (
    let prototype: object | null = controller.prototype as object;
    prototype !== null && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name === 'constructor' || seen.has(name)) {
        continue;
      }

      seen.add(name);

      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      const handler: unknown = descriptor?.value;

      if (
        typeof handler === 'function' &&
        Reflect.hasMetadata(METHOD_METADATA, handler) &&
        Reflect.hasMetadata(PATH_METADATA, handler)
      ) {
        yield [name, handler as RouteHandler];
      }
    }
  }
}

function hasResponseSchema(
  controller: Type<unknown>,
  handler: RouteHandler,
  defaultSchema: StandardSchemaV1 | undefined,
): boolean {
  return (
    (getSerializerSchema(handler) ??
      getSerializerSchema(controller) ??
      defaultSchema) !== undefined
  );
}

function getSerializerSchema(target: object): unknown {
  const options: unknown = Reflect.getMetadata(
    CLASS_SERIALIZER_OPTIONS,
    target,
  );

  return typeof options === 'object' && options !== null && 'schema' in options
    ? options.schema
    : undefined;
}

function isJsonMediaType(contentType: string): boolean {
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? '';

  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

function toPaths(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (Array.isArray(value)) {
    const paths = value.filter(
      (path): path is string => typeof path === 'string',
    );

    return paths.length > 0 ? paths : ['/'];
  }

  return ['/'];
}

function joinPaths(prefix: string, path: string): string {
  const segments = [prefix, path]
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '');

  return `/${segments.join('/')}`;
}

function formatMessage(routes: readonly ResponseSchemaRoute[]): string {
  const lines = routes.map(
    (route) =>
      `  ${route.method} ${route.paths.join(', ')} (${route.controller}.${route.handler})`,
  );
  const subject =
    routes.length === 1
      ? '1 route has no response schema'
      : `${routes.length} routes have no response schema`;

  return [
    `serialization.requireResponseSchema is enabled, but ${subject}:`,
    ...lines,
    'Attach one with @StandardSchemaResponse(), @ApiStandardSchemaResponse(), or @SerializeOptions({ schema }), or exempt the route with @SkipResponseSchema().',
  ].join('\n');
}
