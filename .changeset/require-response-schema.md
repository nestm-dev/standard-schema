---
'@nestm/standard-schema': minor
---

Add an opt-in fail-closed mode for response serialization.

`StandardSchemaModule.forRoot({ serialization: { requireResponseSchema: true } })` makes application bootstrap throw a `MissingResponseSchemaError` that lists every JSON route without a response schema, and turns a schema-less response body that still reaches the serializer into an opaque 500. Routes without a JSON body (`@HttpCode(204)`, `@Redirect()`, `@Render()`, `@Sse()`, non-JSON `@Header('Content-Type', …)`, `HEAD`, and `StreamableFile`) are exempt, and `@SkipResponseSchema()` exempts a route or controller explicitly. `findRoutesWithoutResponseSchema()` exposes the same check for tests. The default behavior is unchanged.
