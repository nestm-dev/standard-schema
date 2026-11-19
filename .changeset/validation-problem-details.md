---
'@nestm/standard-schema': minor
---

Add RFC 9457 problem details for request validation.

`StandardSchemaModule.forRoot({ validation: { problemDetails: true } })` answers invalid input with an `application/problem+json` `validation-failed` problem whose `errors[]` entries carry `in` (`body`, `query`, `path`, or `header`), an RFC 6901 JSON `pointer`, the issue `code`, and its `message`, with Zod's `unrecognized_keys` expanded to one entry per key. `createValidationProblemFactory()`, `ValidationProblemException`, `ValidationProblemFilter`, and `toJsonPointer()` are exported for applications with their own exception filters, and every `validation.exceptionFactory` now also receives the failing parameter's `ArgumentMetadata`.
