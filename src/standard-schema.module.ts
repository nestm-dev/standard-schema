import {
  Module,
  StandardSchemaSerializerInterceptor,
  type DynamicModule,
  type Provider,
  type StandardSchemaSerializerInterceptorOptions,
  type StandardSchemaValidationPipeOptions,
} from '@nestjs/common';
import { APP_INTERCEPTOR, APP_PIPE, Reflector } from '@nestjs/core';

import { StandardSchemaDtoValidationPipe } from './standard-schema-dto-validation.pipe.js';

/** Options forwarded to Nest's native validation and serialization helpers. */
export interface StandardSchemaModuleOptions {
  validation?: false | StandardSchemaValidationPipeOptions;
  serialization?: false | StandardSchemaSerializerInterceptorOptions;
}

@Module({})
export class StandardSchemaModule {
  /**
   * Registers the DTO-aware request pipe and Nest's native Standard Schema
   * serializer as global application enhancers.
   */
  static forRoot(options: StandardSchemaModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [];
    const validationOptions = options.validation;
    const serializationOptions = options.serialization;

    if (validationOptions !== false) {
      providers.push({
        provide: APP_PIPE,
        useFactory: () =>
          new StandardSchemaDtoValidationPipe(validationOptions),
      });
    }

    if (serializationOptions !== false) {
      providers.push({
        provide: APP_INTERCEPTOR,
        inject: [Reflector],
        useFactory: (reflector: Reflector) =>
          new StandardSchemaSerializerInterceptor(
            reflector,
            serializationOptions,
          ),
      });
    }

    return {
      module: StandardSchemaModule,
      providers,
    };
  }
}
