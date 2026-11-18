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

const IsoDateTime = z.codec(z.date(), z.iso.datetime(), {
  decode: (date) => date.toISOString(),
  encode: (iso) => new Date(iso),
});

export const ProductResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  price: z.number().nonnegative(),
  active: z.boolean(),
  publishedAt: IsoDateTime,
});

export type ProductResponse = z.input<typeof ProductResponseSchema>;
export type ProductJson = z.output<typeof ProductResponseSchema>;
```

Prefer `z.codec()` over `.transform()` for values that change shape on the way out. A codec keeps both sides describable, so OpenAPI documents `publishedAt` as a `date-time` string, while a one-way transform cannot be represented in JSON Schema.

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
  publishedAt: z.codec(z.date(), z.iso.datetime(), {
    decode: (date) => date.toISOString(),
    encode: (iso) => new Date(iso),
  }),
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
- Nest's native `StandardSchemaSerializerInterceptor`, or a fail-closed extension of it when `requireResponseSchema` is enabled.

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

### Fail-closed responses

By default, a route without a response schema returns whatever its handler returns, as in plain Nest. Set `serialization.requireResponseSchema` to make a missing response schema an error instead:

```ts
StandardSchemaModule.forRoot({
  serialization: { requireResponseSchema: true },
});
```

With this option:

- Application bootstrap (`app.init()` or `app.listen()`) throws a `MissingResponseSchemaError` that lists every JSON route without a response schema. Its `routes` property holds the controller, handler, HTTP method, and paths of each one, so a test that boots the application doubles as a route-manifest check.
- A route that still returns a body without a schema at request time fails with Nest's opaque `500 Internal server error` response, and the error is logged on the server. The body is never sent.
- A response schema can come from `@StandardSchemaResponse()`, `@ApiStandardSchemaResponse()`, `@SerializeOptions({ schema })` on the handler or controller, or the module-wide `serialization.schema`.

Routes without a JSON body are exempt: `@HttpCode(204)`, `@Redirect()`, `@Render()`, `@Sse()`, a non-JSON `Content-Type` set with `@Header()`, `HEAD` routes, and handlers whose declared return type is `StreamableFile`. At request time, `undefined`, `null`, `StreamableFile`, and streamed bodies are also let through.

Exempt anything else explicitly with `@SkipResponseSchema()`, on a handler or a whole controller:

```ts
import { SkipResponseSchema } from '@nestm/standard-schema';

@Get('export.csv')
@SkipResponseSchema()
export(@Res() response: Response): void {
  response.type('text/csv').send(this.reports.toCsv());
}
```

Routes that write the response themselves through `@Res()` or `@Next()` bypass serialization entirely, so the bootstrap check reports them until they carry `@SkipResponseSchema()`. Asynchronous file handlers (`async download(): Promise<StreamableFile>`) also need it, because their declared return type is only `Promise` at runtime.

`findRoutesWithoutResponseSchema(controllers)` runs the same check over a list of controller classes without booting an application.

### Validation problem details

By default, invalid input produces Nest's native `400 Bad Request` body with a flat list of messages. Set `validation.problemDetails` to answer with an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) `application/problem+json` document instead:

```ts
StandardSchemaModule.forRoot({
  validation: {
    problemDetails: { typeBaseUri: 'https://example.com/problems/' },
  },
});
```

```json
{
  "type": "https://example.com/problems/validation-failed",
  "title": "Request validation failed",
  "status": 400,
  "detail": "2 validation errors in the request body.",
  "errors": [
    {
      "in": "body",
      "pointer": "/lines/0/quantity",
      "code": "too_small",
      "message": "Too small: expected number to be >0"
    },
    {
      "in": "body",
      "pointer": "/coupon~1code",
      "code": "unrecognized_keys",
      "message": "Unrecognized key: \"coupon/code\""
    }
  ]
}
```

Each `errors` entry has:

- `in`: `body`, `query`, or `path`, from the parameter decorator (`@Body()`, `@Query()`, `@Param()`). Custom parameter decorators have no location unless the `location` option maps them, for example to `header`.
- `pointer`: an [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) JSON Pointer into that request part, with `~` escaped as `~0` and `/` as `~1`. A named parameter such as `@Query('page', { schema })` is included in the pointer (`/page`). The empty pointer `""` means the whole part.
- `code`: the schema library's issue code (Zod and ArkType `code`, Valibot `type`), or `invalid`.
- `message`: the schema library's message.

An `unrecognized_keys` issue that names several unknown keys becomes one entry per key.

`problemDetails` accepts `true` or these options:

| Option        | Default                     | Description                                                                                  |
| ------------- | --------------------------- | -------------------------------------------------------------------------------------------- |
| `typeBaseUri` | none                        | Prefixed verbatim to the slug to form `type`. Without it, `type` is the bare, relative slug. |
| `typeSlug`    | `validation-failed`         | The problem type slug.                                                                       |
| `title`       | `Request validation failed` | The problem title.                                                                           |
| `status`      | `errorHttpStatusCode`, 400  | The HTTP status and `status` member.                                                         |
| `detail`      | error count and location    | A string, or a function of the errors and parameter metadata.                                |
| `maxErrors`   | 100                         | The most `errors` entries to include. `detail` still counts them all.                        |
| `location`    | see above                   | Maps a parameter's `ArgumentMetadata` to `body`, `query`, `path`, `header`, or `undefined`.  |

`problemDetails` also registers `ValidationProblemFilter`, which sends the `ValidationProblemException` with the `application/problem+json` content type. If your application has its own catch-all exception filter, it may take precedence. Use the factory directly and let your filter render the problem instead:

```ts
import {
  createValidationProblemFactory,
  ValidationProblemException,
} from '@nestm/standard-schema';

StandardSchemaModule.forRoot({
  validation: {
    exceptionFactory: createValidationProblemFactory({
      typeBaseUri: 'https://example.com/problems/',
    }),
  },
});

// In your exception filter:
if (exception instanceof ValidationProblemException) {
  response
    .status(exception.getStatus())
    .type('application/problem+json')
    .json({ ...exception.problem, instance: request.originalUrl });
}
```

Every `validation.exceptionFactory` receives the parameter's `ArgumentMetadata` as a second argument, so custom factories can tell body, query, and path errors apart too. `exceptionFactory` and `problemDetails` cannot be combined.

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

For array responses, pass the **item** schema, not `z.array(Item)`. Nest's serializer parses an array response item by item, so an array schema would receive each item and reject it. The same applies to `@StandardSchemaResponse`:

```ts
@Get()
@ApiStandardSchemaResponse(ProductResponseSchema, {
  description: 'Products returned.',
  isArray: true,
  status: 200,
})
findAll(): ProductResponse[] {
  // ...
}
```

Responses that wrap an array in an object, such as `{ data: Product[], meta }`, are ordinary objects: describe them with an object schema that contains the array.

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

Registers validation and serialization globally. `validation` and `serialization` accept their corresponding native Nest option objects or `false`. `validation` also accepts `problemDetails` and a metadata-aware `exceptionFactory`; `serialization` also accepts `requireResponseSchema`.

### `@SkipResponseSchema()`

Exempts a route or controller from `serialization.requireResponseSchema`.

### `MissingResponseSchemaError`

Thrown at bootstrap, or at request time, when `requireResponseSchema` finds routes without a response schema. `routes` lists them.

### `findRoutesWithoutResponseSchema(controllers, defaultSchema?)`

Returns the routes of the given controller classes that `requireResponseSchema` would report.

### `createValidationProblemFactory(options?)`

Returns a `validation.exceptionFactory` that throws a `ValidationProblemException` carrying an RFC 9457 validation problem.

### `ValidationProblemException`

An `HttpException` whose `problem` and `getResponse()` are the validation problem document.

### `ValidationProblemFilter`

An exception filter that sends a `ValidationProblemException` as `application/problem+json`. Registered by `validation.problemDetails`.

### `toJsonPointer(path)`

Formats a Standard Schema issue path as an RFC 6901 JSON Pointer.

### Low-level helpers

`getStandardSchema`, `isStandardSchema`, `isSchemaClass`, `isResponseSchemaClass`, `SchemaClass`, `ResponseSchemaClass`, `StandardSchemaSource`, `STANDARD_SCHEMA_CLASS`, and `STANDARD_SCHEMA_RESPONSE_CLASS` are available for custom integrations.

## Scope

The package is a metadata and setup adapter. It does not implement a validation engine, depend on a particular schema vendor, instantiate schema classes, define an application response envelope, or recover runtime schemas from erased aliases and interfaces.

## Compatibility

- NestJS 12
- Nest Swagger 12 for optional OpenAPI integration
- Node.js 22.12 or newer
- TypeScript 5.5 through 7.x for runtime APIs
- TypeScript 5.5 through 6.x for the optional compiler plugin
