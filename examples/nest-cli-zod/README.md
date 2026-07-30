# Nest CLI + Zod example

This application demonstrates the real consumer experience for
`@nestm/standard-schema`:

- request DTO classes discovered by Nest from `@Body()`, `@Query()`, and
  `@Param()`;
- Zod coercion, trimming, defaults, and unknown-key stripping;
- response metadata inferred from controller return annotations by the Nest CLI
  compiler plugin;
- object and array responses serialized by Nest's native Standard Schema
  interceptor; and
- controllers that delegate application behavior to a singleton service.

No response decorator is needed on the controller:

```ts
@Get()
findAll(@Query() query: ListProductsQueryDto): ProductResponseDto[] {
  return this.productsService.findAll(query);
}
```

The `/products/summary` route also demonstrates the explicit
`@StandardSchemaResponse(...)` escape hatch for a return type that is
intentionally ambiguous. The explicit schema is honored with and without the
compiler plugin.

## Run from this repository

From the repository root:

```sh
pnpm install
pnpm run example:start
```

The API listens on `http://localhost:3000` by default. Override it with
`PORT=4000 pnpm run example:start`.

Use `pnpm run example:build` when you only want to compile it.

Run the isolated packed-package verification with:

```sh
pnpm run example:test
```

That command packs the library, copies this example to a temporary directory,
installs the tarball as a real dependency, builds it through the Nest CLI
`tsc` builder, and runs its HTTP smoke test. It also performs a second build
without the plugin to prove that request DTO discovery remains independent
while automatic response serialization is opt-in.

## Try the API

Create a product:

```sh
curl --request POST http://localhost:3000/products \
  --header 'content-type: application/json' \
  --data '{"name":"  Keyboard  ","price":"49.90","ignored":"removed"}'
```

List active products with parsed query parameters:

```sh
curl 'http://localhost:3000/products?active=true&limit=10&offset=0'
```

Find one product with a coerced numeric route parameter:

```sh
curl http://localhost:3000/products/1
```

## Copy into another project

This repository uses `"@nestm/standard-schema": "workspace:*"` so the example
tests the local package. In a separate project, replace that dependency with
the published alpha:

```sh
pnpm add @nestm/standard-schema@alpha
```

Keep the exact NestJS prerelease versions aligned with the versions supported
by the package.
