import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_SCHEMA = Symbol.for(
  '@nestm/standard-schema/skip-response-schema',
);

/**
 * Exempts a route, or every route of a controller, from
 * `serialization.requireResponseSchema`.
 *
 * Use it for responses that intentionally have no schema, such as file
 * downloads written through `@Res()` or plain-text endpoints.
 */
export function SkipResponseSchema(): ClassDecorator & MethodDecorator {
  return SetMetadata(SKIP_RESPONSE_SCHEMA, true);
}
