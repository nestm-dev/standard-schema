# @nestm/standard-schema

## 0.1.0-alpha.7

### Minor Changes

- bead71c: The compiler plugin now documents routes that already declare `@StandardSchemaResponse`.

  `StandardSchemaResponse` is `SerializeOptions` underneath: it drives runtime serialization and
  emits no Swagger metadata. It also counts as an explicit response contract, so inference skipped
  those methods — which meant a fully annotated controller produced a document with no response
  schemas at all. Every operation came out as `200: { description: "" }`.

  With `swagger: true`, a single-argument `@StandardSchemaResponse(Source)` is now rewritten to
  `@ApiStandardSchemaResponse(Source)`. That decorator applies the very same
  `StandardSchemaResponse(Source, {})` and adds `ApiResponse`, so serialization is byte-identical
  and only the document changes.

  Deliberately narrow in two ways:

  - **Single-argument calls only.** With a second argument the two decorators partition options
    differently — `validateOptions` goes to serialization, everything else to Swagger — so
    rewriting could silently move a `SerializeOptions` key into the document. Those are left as
    written; add `@ApiStandardSchemaResponse` by hand if you want them documented.
  - **Never when `@ApiStandardSchemaResponse` is already present.** A hand-written Swagger contract
    is authoritative, including its `isArray` and status. The plugin does not duplicate or override
    it.

  A route returning an array should keep declaring it explicitly with
  `@ApiStandardSchemaResponse(ItemDto, { isArray: true })`: the rewrite carries the source through
  unchanged and does not infer array-ness from an unannotated return type.

## 0.1.0-alpha.6

### Patch Changes

- f3eb880: Make Swagger array response markers interoperable across duplicated package
  copies so decorators and metadata readers agree on array item schemas.

## 0.1.0-alpha.5

### Patch Changes

- Add the optional Swagger response decorator and compiler `swagger` mode for
  native request schemas, serialized response contracts, success statuses, array
  shape (including custom Swagger converters), complete response example
  metadata, explicit-metadata precedence, and build-time ambiguity diagnostics.

## 0.1.0-alpha.4

### Patch Changes

- f0b9efc: Add response-input DTO typing, an opt-in Nest CLI compiler plugin that infers native Standard Schema response metadata from explicit controller return types, and a runnable Nest CLI/Zod example that is verified against the packed package.

## 0.1.0-alpha.3

### Patch Changes

- aafabe1: Install from the `alpha` dist-tag while the package is prerelease-only.

## 0.1.0-alpha.2

### Patch Changes

- 753a4f3: Keep prereleases on the configured npm dist-tag when publishing through GitHub OIDC.

## 0.1.0-alpha.1

### Minor Changes

- 73e21f0: Initial release: runtime DTO classes backed by NestJS 12 native Standard Schema request validation and response serialization.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project intends to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html) after the initial experimental releases.

## [Unreleased]

## [0.1.0-alpha.0] - 2026-07-30

### Added

- `createStandardSchemaDto(schema)` for runtime DTO classes typed from parsed Standard Schema output.
- `StandardSchemaDtoValidationPipe`, which discovers DTO schemas and delegates parsing to Nest's native validation pipe.
- `@StandardSchemaResponse(DtoOrSchema)` for native response serialization metadata.
- `StandardSchemaModule.forRoot()` for global request validation and response serialization setup.
- Documentation and tests demonstrating Zod as one Standard Schema implementation without making it a runtime requirement.

### Notes

- Initial releases target NestJS 12 prereleases and are experimental while the upstream API stabilizes.
