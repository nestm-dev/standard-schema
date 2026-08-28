---
'@nestm/standard-schema': patch
---

Support TypeScript 7 for the runtime DTO, validation, and serialization APIs.
The optional Nest compiler plugin continues to require TypeScript 5.5 through
6.x because TypeScript 7 does not expose the compiler API used by transformers;
it now reports that boundary explicitly.
