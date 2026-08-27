---
"@nestm/standard-schema": minor
---

The plugin's `@StandardSchemaResponse` rewrite now carries a response status.

The rewrite added in the previous release emitted `ApiStandardSchemaResponse(Source)` with no
options, so `@nestjs/swagger` filed the schema under the `default` response key. Most client
generators map `default` to the *error* type, which left every success response untyped — the
schemas were present but not usable for codegen.

The status is derived exactly as the inference path derives it: `@HttpCode` wins, otherwise
`@Post` is 201 and every other verb is 200.

**The rewrite backs off rather than guessing.** It leaves `@StandardSchemaResponse` untouched
when:

- the method takes a raw `@Res()`/`@Response()` parameter — the handler owns the status, and no
  static analysis can see `res.status(...)`;
- the route is `@Redirect()` — Nest discards `@HttpCode` there, so neither the decorator nor the
  verb predicts the status;
- the status resolves to 204 — OpenAPI forbids a body on 204, and the inference path refuses this
  case twice;
- the status is not statically resolvable, e.g. `@HttpCode(SOME_NUMBER)`;
- any `@nestjs/swagger` response decorator is already on the method.

Backing off is a *safe* fallback, not a degraded one: with no response metadata at all, Swagger's
own explorer emits the correct `200`/`201` key. It is the `default` entry that suppressed it.

Two properties this preserves that a naive status would have broken:

- **No new build failures.** Status resolution runs with `onAmbiguous: 'skip'` forced. The
  inference path may throw on an unresolvable status because it is volunteering metadata; the
  rewrite acts on code that already compiles, and those methods are invisible to the preflight
  pass, so a throw would escape mid-transform with a message telling the author to add the
  decorator they already have.
- **No silently destroyed contracts.** Landing on a real status means sharing a response key with
  a hand-written `@ApiOkResponse`/`@ApiResponse`. That merge is destructive in a way decorator
  order cannot fix — `ResponseObjectFactory` short-circuits on `standardSchema` and omits `type`,
  so a hand-written `type: LegacyDto` would vanish with no diagnostic.

`isArray` is deliberately not emitted: the rewrite does no return-type analysis, and the author's
source may already be an array schema, which would be double-wrapped.

A hand-written `@ApiStandardSchemaResponse(Source)` with no `{ status }` still lands on `default`
— that is inherent to the decorator's own signature, and it is explicit user code where the option
is available and now documented in the README.
