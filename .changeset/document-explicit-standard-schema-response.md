---
"@nestm/standard-schema": minor
---

The compiler plugin now documents routes that already declare `@StandardSchemaResponse`.

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
