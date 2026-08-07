# @nestm/standard-schema

DTO ergonomics for NestJS 12's native [Standard Schema](https://standardschema.dev/) validation and serialization.

> [!CAUTION]
> NestJS 12 is currently prerelease software. This package is experimental and may change as Nest's native Standard Schema API stabilizes.

`@nestm/standard-schema` connects runtime DTO classes to the Standard Schema support built into NestJS 12. It is schema-vendor-neutral: Zod is used in the examples, but the library API accepts Standard Schema-compatible schemas.

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

Responses can use the explicit runtime decorator:

```ts
@StandardSchemaResponse(ProductResponseDto)
```

Or an optional Nest CLI compiler plugin can inject the same metadata from an
explicit response DTO return annotation. With `swagger: true`, it also attaches
native request schema metadata and Standard Schema response metadata understood
by `@nestjs/swagger`:

```ts
async findAll(): Promise<ProductResponseDto[]> {
  // ...
}
```

Runtime reflection alone records this return type as `Promise`, so the automatic form is a build-time feature rather than runtime type magic.

## Installation

Install the package alongside NestJS 12 and a Standard Schema implementation:

```sh
pnpm add @nestm/standard-schema@alpha
pnpm add @nestjs/common@12.0.0-alpha.5 @nestjs/core@12.0.0-alpha.5
pnpm add reflect-metadata rxjs
```

For the Zod examples:

```sh
pnpm add zod@4.4.3
```

OpenAPI integration is optional. Install the matching Nest Swagger prerelease
only when using `@nestm/standard-schema/swagger` or compiler
`"swagger": true`:

```sh
pnpm add @nestjs/swagger@12.0.0-alpha.2
```

The commands show the NestJS prerelease used by this package's test suite. Pin the exact framework versions you test instead of leaving a floating prerelease tag in `package.json`.

NestJS 12 alpha packages currently declare some Nest 11 peer ranges internally. Package managers may therefore report peer warnings even when every Nest package is pinned to the same 12 alpha. Those warnings originate in the upstream prerelease package metadata rather than this adapter.

The same upstream mismatch can make npm stop with `ERESOLVE`. For this alpha combination, install with `npm install --legacy-peer-deps` or use pnpm and review its warnings. Remove that workaround once NestJS 12 publishes corrected peer ranges.

## Quick start

### 1. Define schemas and DTO classes

```ts
// products.dto.ts
import {
  createStandardSchemaDto,
  createStandardSchemaResponseDto,
} from '@nestm/standard-schema';
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
  publishedAt: z.date().transform((value) => value.toISOString()),
});

export class ProductResponseDto extends createStandardSchemaResponseDto(
  ProductResponseSchema,
) {}
```

The two factories model opposite sides of schema parsing:

- A request DTO instance is `StandardSchemaV1.InferOutput<Schema>`, because the handler receives the parsed request. In the example, `price` is a number and `active` is present.
- A response DTO instance is `StandardSchemaV1.InferInput<Schema>`, because the handler returns the value that the serializer will parse. In the example, `publishedAt` is a `Date`.
- The HTTP client receives `StandardSchemaV1.InferOutput<Schema>`. In the example, `publishedAt` is an ISO string.

The generated DTO class is a runtime metadata carrier. The controller receives the schema's parsed plain object; the package does not instantiate the DTO or apply class-transformer behavior.

### 2. Register the module once

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { StandardSchemaModule } from '@nestm/standard-schema';
import { ProductsController } from './products.controller.js';

@Module({
  imports: [StandardSchemaModule.forRoot()],
  controllers: [ProductsController],
})
export class AppModule {}
```

`StandardSchemaModule.forRoot()` registers the DTO-aware validation pipe and Nest's native Standard Schema serializer globally. Import it once in the root application module.

### 3. Enable automatic request, response, and OpenAPI metadata

Add the optional plugin to `nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "compilerOptions": {
    "builder": "tsc",
    "plugins": [
      {
        "name": "@nestm/standard-schema",
        "options": {
          "controllerFileNameSuffix": [".controller.ts", ".controller.mts"],
          "onAmbiguous": "error",
          "swagger": true
        }
      }
    ]
  }
}
```

The suffixes shown above and `onAmbiguous: "error"` are the defaults.
`swagger` defaults to `false`, preserving response-only compiler behavior
without an `@nestjs/swagger` dependency. The package exposes a CommonJS
`@nestm/standard-schema/plugin` entry because the Nest CLI loads compiler
plugins synchronously; application code does not import that entry.

### 4. Use normal Nest decorators

```ts
// products.controller.ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { CreateProductDto, ProductResponseDto } from './products.dto.js';

@Controller('products')
export class ProductsController {
  @Post()
  create(@Body() body: CreateProductDto): ProductResponseDto {
    const product = {
      id: 1,
      ...body,
      publishedAt: new Date(),
      internalRevision: 1,
    };

    return product;
  }

  @Get()
  async findAll(): Promise<ProductResponseDto[]> {
    const products = [
      {
        id: 1,
        name: 'Keyboard',
        price: 99,
        active: true,
        publishedAt: new Date(),
        internalRevision: 3,
      },
    ];

    return products;
  }
}
```

The plugin injects native `{ schema: Dto.schema }` options into zero-argument,
whole-object `@Body()`, `@Query()`, and `@Param()` decorators. It also injects
the equivalent of `@ApiStandardSchemaResponse(ProductResponseDto, ...)` for
supported response signatures, including the standard Nest status (`POST` is
201; other routes are 200) and one array layer.

The plugin is optional. Without it, or when a route needs a contract that cannot be inferred, keep the explicit decorator:

```ts
@Get('summary')
@StandardSchemaResponse(ProductSummaryResponseDto)
summary(): ProductSummaryResponseDto {
  return this.products.summary();
}
```

Explicit `@StandardSchemaResponse(...)`,
`@ApiStandardSchemaResponse(...)`, and Nest `@SerializeOptions(...)` metadata
always win, whether placed on the method or controller. DTO classes and raw
Standard Schema objects are accepted by the explicit decorators.

With `swagger: true`, a method carrying a single-argument
`@StandardSchemaResponse(Source)` is rewritten to
`@ApiStandardSchemaResponse(Source, { status })`, so its schema is documented
under the real success status rather than the `default` response key. The status
is derived exactly as inference derives it: `@HttpCode` wins, otherwise `@Post`
is 201 and every other verb is 200.

The rewrite backs off — leaving your decorator untouched — whenever the status
cannot be known or the entry would collide: a raw `@Res()` parameter, a
`@Redirect()` route, `@HttpCode(204)`, a status that is not statically
resolvable, or any `@nestjs/swagger` response decorator already on the method.
Backing off is safe: with no response metadata, Swagger's own explorer emits the
correct status key for you.

**Pass `{ status }` when you write `@ApiStandardSchemaResponse` by hand.**
Without it the schema lands on `default`, which most client generators read as
the error type — leaving the success response untyped.

When Swagger is installed, the composite decorator is also available from its
optional subpath:

```ts
import { ApiStandardSchemaResponse } from '@nestm/standard-schema/swagger';

@Get('summary')
@ApiStandardSchemaResponse(ProductSummaryResponseDto, {
  description: 'Product summary returned.',
  status: 200,
})
summary(): ProductSummaryResponseDto {
  return this.products.summary();
}
```

It combines native runtime serialization with `@nestjs/swagger`
`standardSchema` metadata. `isArray: true` produces an array OpenAPI schema
directly for Standard Schema implementations that expose the Standard JSON
Schema converter.

Nest Swagger 12 alpha.2 does not apply `isArray` after a custom
`standardSchemaConverter`. Wrap that converter once when creating the document
so converter-only schemas retain their response array shape and components:

```ts
import { SwaggerModule } from '@nestjs/swagger';
import { withStandardSchemaResponseArrays } from '@nestm/standard-schema/swagger';

const document = SwaggerModule.createDocument(app, config, {
  standardSchemaConverter: withStandardSchemaResponseArrays(
    standardSchemaConverter,
  ),
});
```

## Runnable example

The complete [Nest CLI + Zod products API](./examples/nest-cli-zod) uses the
same request DTO discovery and compiler-inferred response metadata as a real
consumer. It includes `@Body()`, `@Query()`, and `@Param()` parsing, an
in-memory service, object and array responses, and HTTP plus OpenAPI smoke
tests.

From this repository:

```sh
pnpm install
pnpm run example:start
```

Use `pnpm run example:build` when you only want to compile it.

To verify the example against the actual npm artifact boundary:

```sh
pnpm run example:test
```

The verification packs this package, installs the tarball into an isolated
copy of the example, builds through Nest's CLI, and exercises the HTTP API.

## How it works

### Requests

1. TypeScript emits the concrete DTO class as Nest parameter metadata.
2. With compiler `swagger: true`, zero-argument whole-object request decorators
   are emitted with native `{ schema: Dto.schema }` metadata.
3. Otherwise, `StandardSchemaDtoValidationPipe` discovers the schema stored on
   the reflected DTO class.
4. Nest's native `StandardSchemaValidationPipe` parses the value exactly once.
5. The controller receives the parsed output, including schema-defined
   coercions, transforms, defaults, and key handling.

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

At build time, the optional compiler plugin finds concrete `@Controller()`
route methods with explicit return annotations. When the final type is a class
created by `createStandardSchemaResponseDto(...)`, it injects runtime response
serialization without changing declaration output. In Swagger mode, it also
adds the success status, output Standard Schema, and array shape. Existing
success `@Api*Response({ description })` metadata is merged rather than
discarded.

At runtime, `@StandardSchemaResponse(...)` resolves the class to its schema and composes Nest's native `@SerializeOptions({ schema })` metadata. The serializer registered by `StandardSchemaModule` validates and parses object responses, and applies the item schema to array responses.

Outbound data that does not satisfy the response schema is a server contract error; it is not converted into a client validation error.

### Compiler plugin contract

The plugin infers one response item DTO from these explicit annotations:

| Return annotation                        | Behavior                             |
| ---------------------------------------- | ------------------------------------ |
| `ProductResponseDto`                     | Infer the DTO schema                 |
| `Promise<ProductResponseDto>`            | Unwrap `Promise`                     |
| `ProductResponseDto[]`                   | Infer the array item schema          |
| `readonly ProductResponseDto[]`          | Infer the array item schema          |
| `Array<ProductResponseDto>`              | Infer the array item schema          |
| `Promise<ProductResponseDto[]>`          | Unwrap `Promise` and one array layer |
| `Promise<readonly ProductResponseDto[]>` | Unwrap `Promise` and one array layer |
| `Promise<Array<ProductResponseDto>>`     | Unwrap `Promise` and one array layer |

A direct `import type { ProductResponseDto }` is promoted to a value import in emitted JavaScript when it is safe to do so. The plugin only infers classes created by `createStandardSchemaResponseDto(...)`; request DTOs, interfaces, type aliases, anonymous object types, primitives, and unrelated classes are ignored.

The plugin also skips:

- methods without an explicit return annotation;
- methods without a Nest HTTP route decorator;
- `void`, `Promise<void>`, and 204 routes;
- handlers using raw `@Res()` or `@Response()` (literal
  `{ passthrough: true }` remains eligible); and
- routes already covered by method- or controller-level `@StandardSchemaResponse(...)` or `@SerializeOptions(...)`.

With `"swagger": true`, request inference supports a concrete
`createStandardSchemaDto(...)` subclass on zero-argument whole-object
`@Body()`, `@Query()`, or `@Param()`. A direct type-only import is promoted to a
runtime import when its export chain is safe. Native decorator options that
already contain `schema` win.

Property-bound request DTO decorators, DTO unions, generic wrappers, tuples,
arrays of request DTOs, nested response arrays, and statically unresolved
`@HttpCode(...)` values are ambiguous. Under the default
`"onAmbiguous": "error"` they stop the build with an explicit-decorator
escape hatch. Primitives, streams, raw responses, and 204 routes remain
untouched.

By default, response DTO contracts that are visible but unsafe to reduce to one schema stop the build with guidance to add explicit metadata. This includes unions, intersections, tuples, nested arrays, unresolved generics, structural envelopes such as `Page<ProductResponseDto>`, and DTOs that cannot be referenced safely at runtime. Prefer one concrete response DTO backed by a union or envelope schema:

```ts
class ProductPageResponseDto extends createStandardSchemaResponseDto(
  ProductPageResponseSchema,
) {}
```

To leave ambiguous routes untouched instead, set `"onAmbiguous": "skip"` in the plugin options. An explicit response decorator remains the escape hatch and always overrides inference.

### Compiler compatibility

Automatic request/response metadata currently requires `nest build` with the
Nest CLI `tsc` builder. Plain `tsc`, Vitest, ts-jest, SWC, webpack, and rspack
do not automatically load this plugin. Use explicit metadata when building
through those paths.

The normal package entry is ESM. Only the compiler subpath is CommonJS for the Nest CLI loader, and it is isolated from the runtime entry so applications that do not enable the plugin do not load TypeScript. Continue using `.js` suffixes for local imports in NodeNext ESM source.

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

### `createStandardSchemaResponseDto(schema)`

Creates a response DTO base class whose instance type is `StandardSchemaV1.InferInput<Schema>`.

```ts
class ProductResponseDto extends createStandardSchemaResponseDto(
  ProductResponseSchema,
) {}
```

Annotate a handler return value with the concrete class. Nest's native serializer accepts that input and sends `StandardSchemaV1.InferOutput<Schema>` to the client. The compiler plugin only infers response metadata from DTOs created by this factory.

This separate input type matters for schemas that transform or encode values. It lets a handler return a `Date`, for example, while the serialized client contract exposes a string.

### `StandardSchemaDtoValidationPipe`

A DTO-aware extension of Nest's native `StandardSchemaValidationPipe`. It supplies the schema stored on a DTO class when Nest parameter metadata does not already contain an explicit schema.

Use `StandardSchemaModule.forRoot()` for normal application setup. The pipe is exported for applications that need to compose their own global providers.

### `@StandardSchemaResponse(DtoOrSchema)`

A controller or method decorator that resolves either:

- a class created with `createStandardSchemaDto(...)` or `createStandardSchemaResponseDto(...)`; or
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

### `@nestm/standard-schema/swagger`

The optional subpath exports
`ApiStandardSchemaResponse(source, options)`. Its options combine
`@nestjs/swagger` response metadata (`status`, `description`, `isArray`,
examples, headers, and links) with the native serializer's
`validateOptions`.

It also exports
`withStandardSchemaResponseArrays(standardSchemaConverter)`, which decorates a
custom Nest Swagger converter with array-response handling while preserving the
converter's component schemas. This wrapper is only needed for schemas that
depend on the custom converter instead of exposing the Standard JSON Schema
conversion protocol themselves.

Importing this subpath requires the optional `@nestjs/swagger` peer. The root
runtime entry and compiler-only entry do not load Swagger.

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

`getStandardSchema`, `isStandardSchema`, `isStandardSchemaDto`, `isStandardSchemaResponseDto`, `STANDARD_SCHEMA_DTO`, `STANDARD_SCHEMA_RESPONSE_DTO`, `StandardSchemaDtoClass`, `StandardSchemaResponseDtoClass`, and `StandardSchemaSource` are exported for authors building custom integrations. Application code should normally use the DTO factories, module, pipe, response decorator, and optional compiler plugin instead.

## Native NestJS and this package

Use native NestJS directly when explicit schema metadata is the clearest fit:

```ts
@Body({ schema: CreateProductSchema })
```

Use this package when your team wants runtime DTO classes and the shorter parameter syntax:

```ts
@Body() body: CreateProductDto
```

For responses, choose explicit `@StandardSchemaResponse(...)` metadata or enable the compiler plugin and use a response DTO return annotation. In every case, Nest's native Standard Schema components perform the request and response parsing. This package is an adapter for metadata, not a replacement validation engine and not a Zod-specific DTO layer.

## Difference from `nestjs-zod`

[`nestjs-zod`](https://github.com/BenLorantfy/nestjs-zod) is a mature Zod-specific integration with its own validation pipe, serializer, OpenAPI support, and codec behavior. It calls Zod's parsing APIs directly.

This package has a narrower purpose for NestJS 12: it makes runtime DTO classes ergonomic and can inject native response metadata at compile time while delegating execution to Nest's `StandardSchemaValidationPipe` and `StandardSchemaSerializerInterceptor`. It has no Zod runtime dependency and can carry any schema that implements Standard Schema.

## Current scope

The package focuses on request DTO discovery, response schema metadata, and an
optional bridge to Nest Swagger's native Standard Schema support. It does not
define an application response envelope or recover arbitrary schemas from
erased interfaces, aliases, or structural types.

## Compatibility

- NestJS 12 prereleases
- Node.js 22.12 or newer
- Standard Schema-compatible schema libraries
- TypeScript 5.5 through 6.x when the optional compiler plugin is enabled

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
