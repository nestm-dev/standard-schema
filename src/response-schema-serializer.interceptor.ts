import {
  Injectable,
  StandardSchemaSerializerInterceptor,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type OnApplicationBootstrap,
  type Type,
} from '@nestjs/common';
import type { DiscoveryService } from '@nestjs/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { map, type Observable } from 'rxjs';

import {
  describeRoute,
  findRoutesWithoutResponseSchema,
  isExemptFromResponseSchema,
  MissingResponseSchemaError,
  writesResponseDirectly,
} from './response-schema-policy.js';

/**
 * Nest's Standard Schema serializer, failing closed for HTTP routes that
 * return a body without a response schema.
 *
 * Routes with a schema are serialized by Nest exactly as before.
 */
@Injectable()
export class ResponseSchemaSerializerInterceptor extends StandardSchemaSerializerInterceptor {
  override intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    if (
      context.getType() !== 'http' ||
      (this.getContextOptions(context)?.schema ??
        this.defaultOptions.schema) !== undefined
    ) {
      return super.intercept(context, next);
    }

    const controller = context.getClass();
    const handler = context.getHandler() as (...args: never[]) => unknown;

    if (
      isExemptFromResponseSchema(controller, handler) ||
      writesResponseDirectly(controller, handler.name)
    ) {
      return next.handle();
    }

    return next.handle().pipe(
      map((body: unknown) => {
        if (hasNoJsonBody(body)) {
          return body;
        }

        throw new MissingResponseSchemaError([
          describeRoute(controller, handler),
        ]);
      }),
    );
  }
}

/**
 * Fails application bootstrap when JSON routes have no response schema.
 */
export class ResponseSchemaStartupCheck implements OnApplicationBootstrap {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly defaultSchema?: StandardSchemaV1,
  ) {}

  onApplicationBootstrap(): void {
    const controllers = this.discovery
      .getControllers()
      .map((wrapper) => wrapper.metatype)
      .filter(
        (metatype): metatype is Type<unknown> => typeof metatype === 'function',
      );
    const routes = findRoutesWithoutResponseSchema(
      controllers,
      this.defaultSchema,
    );

    if (routes.length > 0) {
      throw new MissingResponseSchemaError(routes);
    }
  }
}

function hasNoJsonBody(body: unknown): boolean {
  return (
    body === undefined ||
    body === null ||
    body instanceof StreamableFile ||
    isStreamingBody(body)
  );
}

/** Mirrors Nest's check for bodies the router streams instead of serializing. */
function isStreamingBody(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as {
    readonly [Symbol.asyncIterator]?: unknown;
    readonly then?: unknown;
  };

  return (
    (typeof candidate[Symbol.asyncIterator] === 'function' &&
      typeof candidate.then !== 'function') ||
    Object.prototype.toString.call(value) === '[object Response]'
  );
}
