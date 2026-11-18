import { StandardSchemaSerializerInterceptor } from '@nestjs/common';
import {
  APP_FILTER,
  APP_INTERCEPTOR,
  APP_PIPE,
  DiscoveryModule,
  Reflector,
} from '@nestjs/core';

import { ResponseSchemaSerializerInterceptor } from './response-schema-serializer.interceptor.js';
import { StandardSchemaModule } from './standard-schema.module.js';
import { ValidationProblemFilter } from './validation-problem.filter.js';

function provided(
  providers: unknown[] | undefined,
  token: unknown,
): Array<Record<string, unknown>> {
  return (providers ?? []).filter(
    (provider): provider is Record<string, unknown> =>
      typeof provider === 'object' &&
      provider !== null &&
      'provide' in provider &&
      provider.provide === token,
  );
}

function createInterceptor(provider: Record<string, unknown> | undefined) {
  const factory = provider?.['useFactory'] as (reflector: Reflector) => unknown;

  return factory(new Reflector());
}

describe(StandardSchemaModule.name, () => {
  it('registers validation and serialization by default', () => {
    const module = StandardSchemaModule.forRoot();

    expect(module.providers).toHaveLength(2);
    expect(module.imports).toEqual([]);
    expect(
      createInterceptor(provided(module.providers, APP_INTERCEPTOR)[0]),
    ).not.toBeInstanceOf(ResponseSchemaSerializerInterceptor);
    expect(
      createInterceptor(provided(module.providers, APP_INTERCEPTOR)[0]),
    ).toBeInstanceOf(StandardSchemaSerializerInterceptor);
  });

  it('allows either native integration to be disabled', () => {
    const module = StandardSchemaModule.forRoot({
      validation: false,
      serialization: false,
    });

    expect(module.providers).toEqual([]);
  });

  it('registers the fail-closed serializer and its bootstrap check', () => {
    const module = StandardSchemaModule.forRoot({
      serialization: { requireResponseSchema: true },
    });

    expect(module.imports).toEqual([DiscoveryModule]);
    expect(module.providers).toHaveLength(3);
    expect(
      createInterceptor(provided(module.providers, APP_INTERCEPTOR)[0]),
    ).toBeInstanceOf(ResponseSchemaSerializerInterceptor);
  });

  it('registers the problem details filter only when requested', () => {
    expect(
      provided(StandardSchemaModule.forRoot().providers, APP_FILTER),
    ).toEqual([]);
    expect(
      provided(
        StandardSchemaModule.forRoot({ validation: { problemDetails: false } })
          .providers,
        APP_FILTER,
      ),
    ).toEqual([]);
    expect(
      provided(
        StandardSchemaModule.forRoot({ validation: { problemDetails: true } })
          .providers,
        APP_FILTER,
      ),
    ).toEqual([{ provide: APP_FILTER, useClass: ValidationProblemFilter }]);
    expect(
      provided(
        StandardSchemaModule.forRoot({ validation: { problemDetails: true } })
          .providers,
        APP_PIPE,
      ),
    ).toHaveLength(1);
  });
});
