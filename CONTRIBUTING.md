# Contributing

Thank you for helping improve `@nestm/nestjs-standard-schema`.

The project follows NestJS 12's prerelease Standard Schema API. Changes should keep the core integration schema-vendor-neutral and should delegate parsing to Nest's native Standard Schema components.

## Prerequisites

- Node.js 20.19 or newer within Node 20, or Node.js 22.12 or newer
- Corepack
- Git

Enable the package manager declared by the repository:

```sh
corepack enable
```

## Local setup

1. Fork and clone the repository.
2. Create a focused branch from `main`.
3. Install the exact locked dependencies:

   ```sh
   yarn install --immutable
   ```

4. Make your change and add or update tests.
5. Run the project checks:

   ```sh
   yarn check
   ```

The combined check covers formatting, linting, type-checking, unit tests, end-to-end tests, and the production build.

## Design guidelines

- Preserve the native integration boundary: DTO metadata may select a schema, but Nest's native validation pipe and serializer should parse values.
- Keep public APIs compatible with any implementation of Standard Schema.
- Do not add a runtime dependency on Zod for core behavior. Zod can be used in examples and tests.
- Use concrete runtime DTO classes where reflection is required. Do not imply that TypeScript aliases, interfaces, `Promise<T>`, or array item types are available at runtime.
- Keep controller ergonomics predictable. Prefer explicit response schema metadata over inference that fails for common async or list handlers.
- Include `.js` suffixes for local imports in TypeScript source compiled as Node ESM.

## Tests

Tests should cover both type-level ergonomics and runtime behavior where applicable. Important cases include:

- parsed request values reaching the controller;
- coercions, defaults, and transforms;
- `@Body()`, `@Query()`, and `@Param()` DTO discovery;
- explicit native parameter schemas continuing to work;
- object and array response serialization;
- controller-level and method-level response schemas;
- invalid input producing a client validation error; and
- invalid service output remaining a server contract error.

Keep tests isolated and deterministic. A test should not depend on execution order or shared mutable state.

## Pull requests

Keep each pull request limited to one coherent change. In the description:

- explain the problem and chosen behavior;
- call out any public API or peer dependency change;
- link relevant NestJS or Standard Schema source when behavior depends on upstream details;
- list the checks you ran; and
- update `README.md` and `CHANGELOG.md` when user-visible behavior changes.

Maintainers may ask that a breaking change wait until NestJS 12's upstream API is clearer.

## Reporting security issues

Do not open a public issue for a suspected vulnerability. Follow [SECURITY.md](./SECURITY.md).
