# Contributing

Thank you for helping improve `@nestm/standard-schema`.

The project follows NestJS 12's prerelease Standard Schema API. Changes should keep the core integration schema-vendor-neutral and should delegate parsing to Nest's native Standard Schema components.

## Prerequisites

- Node.js 22.12 or newer
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
   pnpm install --frozen-lockfile
   ```

4. Make your change and add or update tests.
5. Run the project checks:

   ```sh
   pnpm run check
   pnpm run test
   pnpm run verify:pack
   ```

These commands cover formatting, linting, type-checking, unit,
compiler-plugin, end-to-end, and example-backed packed-consumer tests, the
production build, and the published package surface.

6. Add a Changeset for user-visible changes:

   ```sh
   pnpm changeset
   ```

Changesets on `main` create or update the release pull request. Merging that release pull request publishes through npm Trusted Publishing, creates the package tag, and creates the GitHub release.

## One-time npm bootstrap

npm only lets maintainers configure a trusted publisher after the package exists. The first prerelease must therefore be published interactively from a clean checkout of `main`:

```sh
npm publish --access public --tag alpha
```

Complete npm's browser or two-factor authentication flow locally; never add an npm token to this repository. Then bind the package to the release workflow:

```sh
npm trust github @nestm/standard-schema \
  --file release.yml \
  --repository nestm-dev/standard-schema \
  --environment release \
  --allow-publish
```

After that one-time setup, merge the Changesets release pull request to let GitHub Actions publish the next alpha through OIDC with provenance. The CI-only release wrapper validates the version against `.changeset/pre.json`, then invokes `changeset publish` with that configured tag so `alpha` keeps pointing to the newest alpha. Changesets remains responsible for npm publishing and release tags. After prerelease mode is exited, publishing falls back to Changesets' normal stable behavior automatically.

## Design guidelines

- Preserve the native integration boundary: DTO metadata may select a schema, but Nest's native validation pipe and serializer should parse values.
- Keep public APIs compatible with any implementation of Standard Schema.
- Do not add a runtime dependency on Zod for core behavior. Zod can be used in examples and tests.
- Keep request DTOs output-oriented: controller parameters receive `StandardSchemaV1.InferOutput<Schema>`.
- Keep response DTOs input-oriented: handlers return `StandardSchemaV1.InferInput<Schema>`, and clients receive `StandardSchemaV1.InferOutput<Schema>`.
- Use concrete runtime DTO classes where reflection is required. Runtime request discovery cannot recover aliases or interfaces.
- Keep response inference build-time and opt-in. It may unwrap supported `Promise` and array annotations only when the TypeScript compiler plugin has a concrete response-branded DTO.
- Let explicit `@StandardSchemaResponse(...)` or `@SerializeOptions(...)` metadata win. Ambiguous response DTO contracts should fail by default or honor the configured skip behavior.
- Keep the CommonJS compiler entry isolated from the ESM runtime entry. Runtime users should not load TypeScript merely by importing the package.
- Include `.js` suffixes for local imports in TypeScript source compiled as Node ESM.

## Tests

Tests should cover both type-level ergonomics and runtime behavior where applicable. Important cases include:

- parsed request values reaching the controller;
- coercions, defaults, and transforms;
- response handler input types and serialized client output types;
- `@Body()`, `@Query()`, and `@Param()` DTO discovery;
- explicit native parameter schemas continuing to work;
- object and array response serialization;
- controller-level and method-level response schemas;
- compiler output for direct, async, and list return annotations;
- unchanged declaration output and useful ambiguity diagnostics;
- type-only imports, aliases, identifier collisions, custom controller suffixes, and transformer idempotence;
- explicit response metadata overriding compiler inference;
- the public example resolving the packed CommonJS plugin and building through
  the Nest CLI `tsc` builder;
- invalid input producing a client validation error; and
- invalid service output remaining a server contract error.

Keep tests isolated and deterministic. A test should not depend on execution order or shared mutable state.

Run a focused suite while developing, then run the full checks before opening a pull request:

```sh
pnpm run test:unit
pnpm run test:plugin
pnpm run test:e2e
pnpm run example:test
```

`test:plugin` runs transformer tests against built output. `example:test`
installs the actual tarball into an isolated copy of
[`examples/nest-cli-zod`](./examples/nest-cli-zod) and verifies both
plugin-enabled and plugin-disabled builds. `test:packed` remains an alias for
that command. The aggregate `pnpm run test` command runs all four suites.

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
