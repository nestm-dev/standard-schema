# @nestm/standard-schema

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
