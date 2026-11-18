/**
 * Metadata keys written by Nest's own decorators.
 *
 * Nest only exports them from its internal entry point, which is not part of
 * its public API, so they are mirrored here. A unit test keeps these values in
 * sync with `@nestjs/common/internal`.
 */
export const PATH_METADATA = 'path';
export const METHOD_METADATA = 'method';
export const ROUTE_ARGS_METADATA = '__routeArguments__';
export const HTTP_CODE_METADATA = '__httpCode__';
export const HEADERS_METADATA = '__headers__';
export const REDIRECT_METADATA = '__redirect__';
export const RENDER_METADATA = '__renderTemplate__';
export const RESPONSE_PASSTHROUGH_METADATA = '__responsePassthrough__';
export const SSE_METADATA = '__sse__';
export const CLASS_SERIALIZER_OPTIONS = 'class_serializer:options';

/** `RouteParamtypes.RESPONSE` and `RouteParamtypes.NEXT` from Nest. */
export const RESPONSE_ROUTE_PARAMTYPE = 1;
export const NEXT_ROUTE_PARAMTYPE = 2;
