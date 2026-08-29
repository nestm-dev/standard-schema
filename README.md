# @nestm/standard-schema

Schema-first validation, serialization, and OpenAPI integration for NestJS using [Standard Schema](https://standardschema.dev/).

> [!CAUTION]
> This package is prerelease software. Its API may change before the first stable release.

`@nestm/standard-schema` builds on the native Standard Schema validation and serialization support in NestJS 12. It accepts schemas from Zod, Valibot, ArkType, or any other Standard Schema-compatible library.

Raw schemas are the primary contract. Optional schema classes provide the familiar zero-argument `@Body()`, `@Query()`, and `@Param()` experience when runtime reflection is useful.

## Installation

Install the package alongside NestJS 12 and your schema library:

```sh
pnpm add @nestm/standard-schema@alpha
pnpm add @nestjs/common@12 @nestjs/core@12 reflect-metadata rxjs
pnpm add zod
```

OpenAPI support is optional:

```sh
pnpm add @nestjs/swagger@12
```

## Schema-first usage

Define schemas using the library your application already uses:

```ts
// product.schemas.ts
import { z } from 'zod';

export const CreateProductSchema = z.object({
  name: z.string().trim().min(1),
  price: z.coerce.number().nonnegative(),
  active: z.boolean().default(true),
});

export type CreateProduct = z.output<typeof CreateProductSchema>;

export const ProductResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  price: z.number().nonnegative(),
  active: z.boolean(),
  publishedAt: z.date().transform((value) => value.toISOString()),
});

export type ProductResponse = z.input<typeof ProductResponseSchema>;
export type ProductJson = z.output<typeof ProductResponseSchema>;
```

Pass request schemas through Nest's native decorator metadata:

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { StandardSchemaResponse } from '@nestm/standard-schema';
import {
  CreateProductSchema,
  ProductResponseSchema,
  type CreateProduct,
  type ProductResponse,
} from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Post()
  @StandardSchemaResponse(ProductResponseSchema)
  create(
    @Body({ schema: CreateProductSchema }) input: CreateProduct,
  ): ProductResponse {
    return {
      id: 1,
      ...input,
      publishedAt: new Date(),
    };
  }
}
```

The request handler receives the schema output after coercions, defaults, transforms, and key handling. The response handler returns the response schema input, and the HTTP client receives its output.

## Optional schema classes

Type aliases are erased from emitted JavaScript, so Nest cannot discover a schema from this parameter alone:

```ts
create(@Body() input: CreateProduct) {}
```

Use a schema class when you want automatic runtime discovery with a zero-argument Nest decorator:

```ts
import {
  createResponseSchemaClass,
  createSchemaClass,
} from '@nestm/standard-schema';
import { z } from 'zod';

const CreateProductSchema = z.object({
  name: z.string().trim().min(1),
  price: z.coerce.number().nonnegative(),
});

export class CreateProduct extends createSchemaClass(CreateProductSchema) {}

const ProductResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  publishedAt: z.date().transform((value) => value.toISOString()),
});

export class ProductResponse extends createResponseSchemaClass(
  ProductResponseSchema,
) {}
```

The controller keeps the familiar class-reflection form:

```ts
@Post()
@StandardSchemaResponse(ProductResponse)
create(@Body() input: CreateProduct): ProductResponse {
  return {
    id: 1,
    ...input,
    publishedAt: new Date(),
  };
}
```

A schema class is a runtime metadata adapter, not an instantiated transport object. The controller receives the parsed plain value returned by the schema. The schema remains the source of truth.

`createSchemaClass()` gives the class instance the schema output type used by request handlers. `createResponseSchemaClass()` gives it the schema input type accepted from response handlers. Both retain the original raw schema for delegation to Nest and Swagger.

## Application setup

Register the module once in the root application module:

```ts
import { Module } from '@nestjs/common';
import { StandardSchemaModule } from '@nestm/standard-schema';

@Module({
  imports: [StandardSchemaModule.forRoot()],
})
export class AppModule {}
```

The module globally registers:

- `SchemaClassValidationPipe`, a thin extension that discovers schemas from reflected schema classes before delegating to Nest's native `StandardSchemaValidationPipe`.
- Nest's native `StandardSchemaSerializerInterceptor`.

Explicit `{ schema }` request metadata always takes priority over a reflected schema class.

Both integrations can be configured or disabled independently:

```ts
StandardSchemaModule.forRoot({
  validation: {
    transform: true,
  },
  serialization: false,
});
```

Do not register duplicate global Standard Schema pipes or serializers. Schemas with non-idempotent transforms would otherwise be parsed more than once.

## OpenAPI

`@nestm/standard-schema/swagger` combines runtime response serialization and Nest Swagger metadata:

```ts
import { ApiStandardSchemaResponse } from '@nestm/standard-schema/swagger';

@Post()
@ApiStandardSchemaResponse(ProductResponseSchema, {
  description: 'Product created.',
  status: 201,
})
create(
  @Body({ schema: CreateProductSchema }) input: CreateProduct,
): ProductResponse {
  // ...
}
```

Raw schemas and response schema classes are both accepted. Pass `isArray: true` when the response is an array of items.

Pass an explicit `status` when writing `@ApiStandardSchemaResponse` by hand. Without one, Nest Swagger stores the schema under the `default` response key.

## Optional Nest CLI plugin

The compiler plugin preserves automatic response serialization and OpenAPI metadata when controllers use schema-class return annotations:

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

With the plugin enabled:

- A zero-argument whole-object `@Body()`, `@Query()`, or `@Param()` using a request schema class receives native `{ schema: Class.schema }` metadata.
- A concrete response schema-class return annotation receives runtime `@StandardSchemaResponse(...)` metadata.
- With `swagger: true`, request and response schemas, success status, and one response array layer are documented.
- Explicit native, package, or Swagger metadata always wins.

The plugin supports concrete response classes, `Promise<Class>`, `Class[]`, `readonly Class[]`, and one combination of `Promise` plus an array. Ambiguous unions, intersections, tuples, nested arrays, and generic envelopes require an explicit response decorator by default. Set `onAmbiguous` to `"skip"` to leave them untouched.

Automatic compiler metadata currently requires the Nest CLI `tsc` builder with TypeScript 5.5 through 6.x. TypeScript 7 applications can use all runtime APIs with explicit request and response schema metadata, but its native compiler does not expose the transformer API used by this plugin.

## API

### `createSchemaClass(schema)`

Creates a reflectable class whose instance type is `StandardSchemaV1.InferOutput<Schema>`. The parsed output must be an object.

### `createResponseSchemaClass(schema)`

Creates a reflectable response class whose instance type is `StandardSchemaV1.InferInput<Schema>`. The schema input must be an object.

### `SchemaClassValidationPipe`

Discovers a raw schema from reflected schema-class metadata and delegates to Nest's native validation pipe. Normal applications should register it through `StandardSchemaModule.forRoot()`.

### `@StandardSchemaResponse(schemaOrClass, options?)`

Attaches a raw schema or schema class through Nest's native serialization metadata. `validateOptions` is forwarded to the schema's `~standard.validate()` call.

### `@ApiStandardSchemaResponse(schemaOrClass, options?)`

Available from `@nestm/standard-schema/swagger`. Combines `@StandardSchemaResponse` with `@nestjs/swagger` response metadata.

### `StandardSchemaModule.forRoot(options?)`

Registers validation and serialization globally. `validation` and `serialization` accept their corresponding native Nest option objects or `false`.

### Low-level helpers

`getStandardSchema`, `isStandardSchema`, `isSchemaClass`, `isResponseSchemaClass`, `SchemaClass`, `ResponseSchemaClass`, `StandardSchemaSource`, `STANDARD_SCHEMA_CLASS`, and `STANDARD_SCHEMA_RESPONSE_CLASS` are available for custom integrations.

## Migrating from 0.1 alpha

This release intentionally provides no compatibility aliases:

| 0.1 alpha                          | Schema-first API                                 |
| ---------------------------------- | ------------------------------------------------ |
| `createStandardSchemaDto`          | `createSchemaClass`                              |
| `createStandardSchemaResponseDto`  | `createResponseSchemaClass`                      |
| `StandardSchemaDtoValidationPipe`  | `SchemaClassValidationPipe`                      |
| `StandardSchemaDtoClass`           | `SchemaClass`                                    |
| `StandardSchemaResponseDtoClass`   | `ResponseSchemaClass`                            |
| `isStandardSchemaDto`              | `isSchemaClass`                                  |
| `isStandardSchemaResponseDto`      | `isResponseSchemaClass`                          |
| `STANDARD_SCHEMA_DTO`              | `STANDARD_SCHEMA_CLASS`                          |
| `STANDARD_SCHEMA_RESPONSE_DTO`     | `STANDARD_SCHEMA_RESPONSE_CLASS`                 |
| `withStandardSchemaResponseArrays` | Removed; Nest Swagger 12 handles arrays natively |

Rename `*.dto.ts` files to `*.schemas.ts` or `*.contracts.ts` and remove `Dto` suffixes from schema-class names. Existing 0.1 alpha releases remain available for applications that need the previous API.

## Scope

The package is a metadata and setup adapter. It does not implement a validation engine, depend on a particular schema vendor, instantiate schema classes, define an application response envelope, or recover runtime schemas from erased aliases and interfaces.

## Compatibility

- NestJS 12
- Nest Swagger 12 for optional OpenAPI integration
- Node.js 22.12 or newer
- TypeScript 5.5 through 7.x for runtime APIs
- TypeScript 5.5 through 6.x for the optional compiler plugin
