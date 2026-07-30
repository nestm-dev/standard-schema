# @nestm/nestjs-standard-schema

DTO ergonomics for NestJS 12's native [Standard Schema](https://standardschema.dev/) validation and serialization.

> [!CAUTION]
> NestJS 12 is currently prerelease software. This package is experimental and may change as Nest's native Standard Schema API stabilizes.

`@nestm/nestjs-standard-schema` connects runtime DTO classes to the Standard Schema support built into NestJS 12. It is schema-vendor-neutral: Zod is used in the examples, but the library API accepts Standard Schema-compatible schemas.

## Why this exists

Nest's native API is deliberately explicit:

```ts
@Body({ schema: CreateProductSchema })
create(body: CreateProduct): Product {
  // ...
}
```

That is ideal when using TypeScript type aliases, because aliases do not exist at runtime. If you prefer the familiar DTO-class syntax, this package lets the schema live on a runtime class:

```ts
@Body()
create(body: CreateProductDto): Product {
  // ...
}
```

The DTO-aware pipe finds the schema on `CreateProductDto` and delegates validation and transformation to Nest's native `StandardSchemaValidationPipe`.

Response schemas remain explicit:

```ts
@StandardSchemaResponse(ProductResponseDto)
```

This is intentional. Runtime return metadata records `Promise<Product>` as `Promise` and `Product[]` as `Array`, so the item schema cannot be inferred safely from the TypeScript return type.

## Installation

Install the package alongside NestJS 12 and a Standard Schema implementation:

```sh
yarn add @nestm/nestjs-standard-schema
yarn add @nestjs/common@12.0.0-alpha.5 @nestjs/core@12.0.0-alpha.5
yarn add reflect-metadata rxjs
```

For the Zod examples:

```sh
yarn add zod@4.4.3
```

The commands show the NestJS prerelease used by this package's test suite. Pin the exact framework versions you test instead of leaving a floating prerelease tag in `package.json`.

NestJS 12 alpha packages currently declare some Nest 11 peer ranges internally. Yarn may therefore report `YN0060` peer warnings even when every Nest package is pinned to the same 12 alpha. Those warnings originate in the upstream prerelease package metadata rather than this adapter.

The same upstream mismatch can make npm stop with `ERESOLVE`. For this alpha combination, install with `npm install --legacy-peer-deps` or use Yarn and review its warnings. Remove that workaround once NestJS 12 publishes corrected peer ranges.

## Quick start

### 1. Define schemas and DTO classes

```ts
// products.dto.ts
import { createStandardSchemaDto } from '@nestm/nestjs-standard-schema';
import { z } from 'zod';

export const CreateProductSchema = z.object({
  name: z.string().trim().min(1),
  price: z.coerce.number().nonnegative(),
  active: z.boolean().default(true),
});

export class CreateProductDto extends createStandardSchemaDto(
  CreateProductSchema,
) {}

export const ProductResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  price: z.number().nonnegative(),
  active: z.boolean(),
});

export class ProductResponseDto extends createStandardSchemaDto(
  ProductResponseSchema,
) {}
```

The instance type of each generated class is the schema's parsed output type. Coercions, transforms, and defaults therefore appear in the controller's TypeScript type as well as its runtime value.

The generated DTO class is a runtime metadata carrier. The controller receives the schema's parsed plain object; the package does not instantiate the DTO or apply class-transformer behavior.

### 2. Register the module once

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { StandardSchemaModule } from '@nestm/nestjs-standard-schema';
import { ProductsController } from './products.controller.js';

@Module({
  imports: [StandardSchemaModule.forRoot()],
  controllers: [ProductsController],
})
export class AppModule {}
```

`StandardSchemaModule.forRoot()` registers the DTO-aware validation pipe and Nest's native Standard Schema serializer globally. Import it once in the root application module.

### 3. Use normal Nest parameter decorators

```ts
// products.controller.ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { StandardSchemaResponse } from '@nestm/nestjs-standard-schema';
import { CreateProductDto, ProductResponseDto } from './products.dto.js';

@Controller('products')
@StandardSchemaResponse(ProductResponseDto)
export class ProductsController {
  @Post()
  create(@Body() body: CreateProductDto) {
    return {
      id: 1,
      ...body,
      internalRevision: 1,
    };
  }

  @Get()
  findAll() {
    return [
      {
        id: 1,
        name: 'Keyboard',
        price: 99,
        active: true,
        internalRevision: 3,
      },
    ];
  }
}
```

The response decorator can be placed on a controller when all its object and list routes share one response item schema. Add it to an individual method when that method has a different response contract:

```ts
@Get('summary')
@StandardSchemaResponse(ProductSummarySchema)
summary() {
  return this.products.summary();
}
```

Both DTO classes and raw Standard Schema objects are accepted by `@StandardSchemaResponse(...)`.

## What happens at runtime

### Requests

1. TypeScript emits the concrete DTO class as Nest parameter metadata.
2. `StandardSchemaDtoValidationPipe` reads the Standard Schema stored on that class.
3. The pipe passes the value and schema to Nest's native `StandardSchemaValidationPipe`.
4. The controller receives the parsed output, including schema-defined coercions, transforms, defaults, and key handling.

Automatic discovery requires the normal Nest TypeScript decorator metadata options, including `experimentalDecorators` and `emitDecoratorMetadata`.

This also means interfaces and type aliases cannot provide automatic schema lookup:

```ts
type CreateProduct = z.output<typeof CreateProductSchema>;

// CreateProduct is erased at runtime, so use Nest's explicit native form:
create(
  @Body({ schema: CreateProductSchema }) body: CreateProduct,
) {}
```

### Responses

`@StandardSchemaResponse(...)` resolves a DTO class to its schema and composes Nest's native `@SerializeOptions({ schema })` metadata. The serializer registered by `StandardSchemaModule` validates and parses object responses, and applies the item schema to array responses.

Outbound data that does not satisfy the response schema is a server contract error; it is not converted into a client validation error.

## API

### `createStandardSchemaDto(schema)`

Creates a runtime DTO base class backed by a Standard Schema whose parsed output is an object.

```ts
class SearchQueryDto extends createStandardSchemaDto(SearchQuerySchema) {}
```

Extend the returned class so Nest can reflect the concrete DTO type from `@Body()`, `@Query()`, or `@Param()`.

The parsed output must be an object. A scalar parameter such as an ID should keep Nest's explicit native form:

```ts
findOne(
  @Param('id', { schema: ProductIdSchema }) id: number,
) {}
```

For a DTO-discovered route parameter, validate the whole params object instead:

```ts
class ProductParamsDto extends createStandardSchemaDto(
  z.object({ id: z.coerce.number().int().positive() }),
) {}

findOne(@Param() params: ProductParamsDto) {}
```

Likewise, `@Body() items: ItemDto[]` reflects only the `Array` constructor. Attach an explicit array schema or create one DTO carrier whose schema parses the whole array.

### `StandardSchemaDtoValidationPipe`

A DTO-aware extension of Nest's native `StandardSchemaValidationPipe`. It supplies the schema stored on a DTO class when Nest parameter metadata does not already contain an explicit schema.

Use `StandardSchemaModule.forRoot()` for normal application setup. The pipe is exported for applications that need to compose their own global providers.

### `@StandardSchemaResponse(DtoOrSchema)`

A controller or method decorator that resolves either:

- a class created with `createStandardSchemaDto(...)`; or
- a Standard Schema object.

It then supplies that schema through Nest's native serialization options.

An optional second argument accepts `validateOptions`, which is passed through to Nest's native serializer:

```ts
@StandardSchemaResponse(ProductResponseDto, {
  validateOptions: {
    // Standard Schema validation options
  },
})
```

### `StandardSchemaModule.forRoot(options?)`

Returns a Nest dynamic module that globally registers:

- `StandardSchemaDtoValidationPipe`; and
- Nest's native Standard Schema serializer.

Import it once at the application root.

Do not also register Nest's native global Standard Schema pipe or serializer separately. Explicitly annotated values could otherwise be parsed twice, which is observable for non-idempotent transforms.

Both integrations are enabled by default. `forRoot` also accepts Nest's native option objects, or `false` to skip one of the global providers:

```ts
interface StandardSchemaModuleOptions {
  validation?: false | StandardSchemaValidationPipeOptions;
  serialization?: false | StandardSchemaSerializerInterceptorOptions;
}
```

For example, an application that registers its own response interceptor can disable only the module's serializer:

```ts
StandardSchemaModule.forRoot({
  serialization: false,
});
```

### Low-level helpers

`getStandardSchema`, `isStandardSchema`, `isStandardSchemaDto`, `STANDARD_SCHEMA_DTO`, `StandardSchemaDtoClass`, and `StandardSchemaSource` are exported for authors building custom integrations. Application code should normally use the DTO factory, module, pipe, and response decorator instead.

## Native NestJS and this package

Use native NestJS directly when explicit schema metadata is the clearest fit:

```ts
@Body({ schema: CreateProductSchema })
```

Use this package when your team wants runtime DTO classes and the shorter parameter syntax:

```ts
@Body() body: CreateProductDto
```

In both cases, Nest's native Standard Schema components perform the request and response parsing. This package is an adapter for runtime metadata, not a replacement validation engine and not a Zod-specific DTO layer.

## Difference from `nestjs-zod`

[`nestjs-zod`](https://github.com/BenLorantfy/nestjs-zod) is a mature Zod-specific integration with its own validation pipe, serializer, OpenAPI support, and codec behavior. It calls Zod's parsing APIs directly.

This package has a narrower purpose for NestJS 12: it makes runtime DTO classes ergonomic while delegating execution to Nest's native `StandardSchemaValidationPipe` and `StandardSchemaSerializerInterceptor`. It has no Zod runtime dependency and can carry any schema that implements Standard Schema.

## Current scope

The package focuses on request DTO discovery and response schema metadata. It does not generate OpenAPI documents, define an application response envelope, or infer schemas from erased TypeScript types.

## Compatibility

- NestJS 12 prereleases
- Node.js 20.19 or newer within Node 20, and Node.js 22.12 or newer
- Standard Schema-compatible schema libraries

Because NestJS 12 is still in alpha, keep package and framework versions pinned in applications and review release notes before upgrading.

## Upstream references

- [NestJS 12 Standard Schema integration](https://github.com/nestjs/nest/pull/16391)
- [Standard Schema specification](https://standardschema.dev/schema)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for local setup and pull request guidance.

## Security

See [SECURITY.md](./SECURITY.md) for reporting instructions.

## License

[MIT](./LICENSE) © 2026 Kauan Guesser
