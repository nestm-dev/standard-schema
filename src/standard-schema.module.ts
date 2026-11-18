import {
  Module,
  StandardSchemaSerializerInterceptor,
  type DynamicModule,
  type Provider,
  type StandardSchemaSerializerInterceptorOptions,
} from '@nestjs/common';
import {
  APP_FILTER,
  APP_INTERCEPTOR,
  APP_PIPE,
  DiscoveryModule,
  DiscoveryService,
  Reflector,
} from '@nestjs/core';

import {
  ResponseSchemaSerializerInterceptor,
  ResponseSchemaStartupCheck,
} from './response-schema-serializer.interceptor.js';
import {
  SchemaClassValidationPipe,
  type SchemaClassValidationPipeOptions,
} from './schema-class-validation.pipe.js';
import { ValidationProblemFilter } from './validation-problem.filter.js';

export interface StandardSchemaSerializationOptions extends StandardSchemaSerializerInterceptorOptions {
  /**
   * Fails closed for JSON routes without a response schema.
   *
   * Application bootstrap throws a `MissingResponseSchemaError` listing every
   * such route, and a route that still returns a body without a schema fails
   * with an opaque 500 response. Exempt a route or controller with
   * `@SkipResponseSchema()`. Defaults to `false`.
   */
  requireResponseSchema?: boolean;
}

/** Options for the native Nest validation and serialization integrations. */
export interface StandardSchemaModuleOptions {
  validation?: false | SchemaClassValidationPipeOptions;
  serialization?: false | StandardSchemaSerializationOptions;
}

@Module({})
export class StandardSchemaModule {
  /**
   * Registers the schema-class-aware request pipe and Nest's native Standard Schema
   * serializer as global application enhancers.
   */
  static forRoot(options: StandardSchemaModuleOptions = {}): DynamicModule {
    const imports: NonNullable<DynamicModule['imports']> = [];
    const providers: Provider[] = [];
    const validationOptions = options.validation;
    const serializationOptions = options.serialization;

    if (validationOptions !== false) {
      providers.push({
        provide: APP_PIPE,
        useFactory: () => new SchemaClassValidationPipe(validationOptions),
      });

      if (
        validationOptions?.problemDetails !== undefined &&
        validationOptions.problemDetails !== false
      ) {
        providers.push({
          provide: APP_FILTER,
          useClass: ValidationProblemFilter,
        });
      }
    }

    if (serializationOptions !== false) {
      const { requireResponseSchema = false, ...interceptorOptions } =
        serializationOptions ?? {};

      if (requireResponseSchema) {
        imports.push(DiscoveryModule);
        providers.push(
          {
            provide: APP_INTERCEPTOR,
            inject: [Reflector],
            useFactory: (reflector: Reflector) =>
              new ResponseSchemaSerializerInterceptor(
                reflector,
                interceptorOptions,
              ),
          },
          {
            provide: ResponseSchemaStartupCheck,
            inject: [DiscoveryService],
            useFactory: (discovery: DiscoveryService) =>
              new ResponseSchemaStartupCheck(
                discovery,
                interceptorOptions.schema,
              ),
          },
        );
      } else {
        providers.push({
          provide: APP_INTERCEPTOR,
          inject: [Reflector],
          useFactory: (reflector: Reflector) =>
            new StandardSchemaSerializerInterceptor(
              reflector,
              interceptorOptions,
            ),
        });
      }
    }

    return {
      module: StandardSchemaModule,
      imports,
      providers,
    };
  }
}
