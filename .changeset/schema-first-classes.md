---
'@nestm/standard-schema': minor
---

Replace the DTO-oriented API with schema-first validation, serialization, and OpenAPI integration.

Raw Standard Schemas remain first-class through Nest's native decorator metadata. Applications that want zero-argument `@Body()`, `@Query()`, and `@Param()` reflection can use the new `createSchemaClass` and `createResponseSchemaClass` adapters. The runtime pipe, compiler plugin, examples, diagnostics, and low-level types now use schema-class terminology, and the deprecated Swagger array adapter has been removed.

This is an intentional breaking change with no compatibility aliases. Existing 0.1 alpha releases remain available for applications using the previous DTO API.
