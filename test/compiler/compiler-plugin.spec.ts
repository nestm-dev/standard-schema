import { createRequire } from 'node:module';

import type ts from 'typescript';

import { compileFixture, formatDiagnostics } from './compile-fixture.js';

const schemaClassSource = `
import {
  createSchemaClass,
  createResponseSchemaClass,
} from '@nestm/standard-schema';
import { z } from 'zod';

const ProductResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  publishedAt: z.date().transform((value) => value.toISOString()),
});

export class ProductResponse extends createResponseSchemaClass(
  ProductResponseSchema,
) {}

export class OtherProductResponse extends createResponseSchemaClass(
  ProductResponseSchema,
) {}

export class ProductInput extends createSchemaClass(
  z.object({ name: z.string() }),
) {}

export class ProductLookup extends createSchemaClass(
  z.object({ id: z.coerce.number() }),
) {}

export interface UnusedType {
  readonly ignored: true;
}
`;

describe('@nestm/standard-schema Nest compiler plugin', () => {
  it('publishes a synchronous CommonJS plugin entry', () => {
    const require = createRequire(import.meta.url);
    const resolved = require.resolve('@nestm/standard-schema/plugin');
    const loaded = require(resolved) as {
      readonly before?: unknown;
    };

    expect(resolved).toMatch(/dist\/plugin\/index\.cjs$/);
    expect(loaded.before).toBeTypeOf('function');
  });

  it('injects response metadata for direct, async, and list signatures', () => {
    const controllerSource = `
import { Controller, Get } from '@nestjs/common';
import type {
  ProductResponse,
  UnusedType,
} from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Get('direct')
  direct(): ProductResponse {
    return { id: 1, name: 'Direct', publishedAt: new Date() };
  }

  @Get('async')
  async asyncOne(): Promise<ProductResponse> {
    return { id: 2, name: 'Async', publishedAt: new Date() };
  }

  @Get('array')
  array(): ProductResponse[] {
    return [];
  }

  @Get('generic-array')
  genericArray(): Array<ProductResponse> {
    return [];
  }

  @Get('async-array')
  async asyncArray(): Promise<ProductResponse[]> {
    return [];
  }

  @Get('readonly-array')
  readonlyArray(): readonly ProductResponse[] {
    return [];
  }

  @Get('async-readonly-array')
  async asyncReadonlyArray(): Promise<readonly ProductResponse[]> {
    return [];
  }
}
`;
    const baseline = compileFixture(
      {
        'product.schemas.ts': schemaClassSource,
        'products.controller.ts': controllerSource,
      },
      { usePlugin: false },
    );
    const transformed = compileFixture({
      'product.schemas.ts': schemaClassSource,
      'products.controller.ts': controllerSource,
    });

    expect(formatDiagnostics(transformed.diagnostics)).toBe('');

    const javascript = getOutput(transformed.emitted, 'products.controller.js');
    const baselineDeclaration = getOutput(
      baseline.emitted,
      'products.controller.d.ts',
    );
    const transformedDeclaration = getOutput(
      transformed.emitted,
      'products.controller.d.ts',
    );

    expect(javascript).toContain(
      'import * as _nestmStandardSchema from "@nestm/standard-schema";',
    );
    expect(javascript).toMatch(
      /import \{ ProductResponse \} from ['"]\.\/product\.schemas\.js['"];/,
    );
    expect(javascript).not.toContain('UnusedType');
    expect(
      countOccurrences(
        javascript,
        '_nestmStandardSchema.StandardSchemaResponse(ProductResponse)',
      ),
    ).toBe(7);
    expect(transformedDeclaration).toBe(baselineDeclaration);
  });

  it('supports aliased decorators and type-only schema-class imports without collisions', () => {
    const result = compileFixture({
      'product.schemas.ts': schemaClassSource,
      'products.controller.ts': `
import {
  Controller as ApiController,
  Get as Read,
} from '@nestjs/common';
import type {
  ProductResponse as ProductContract,
} from './product.schemas.js';

const _nestmStandardSchema = 'occupied';

@ApiController('products')
export class ProductsController {
  @Read()
  find(): ProductContract {
    return { id: 1, name: _nestmStandardSchema, publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toContain(
      'import * as _nestmStandardSchema2 from "@nestm/standard-schema";',
    );
    expect(javascript).toMatch(
      /import \{ ProductResponse as ProductContract \} from ['"]\.\/product\.schemas\.js['"];/,
    );
    expect(javascript).toContain(
      '_nestmStandardSchema2.StandardSchemaResponse(ProductContract)',
    );
  });

  it('recognizes Nest route decorators re-exported through a local barrel', () => {
    const result = compileFixture({
      'nest-common.ts': `
export { Controller, Get } from '@nestjs/common';
`,
      'product.schemas.ts': schemaClassSource,
      'products.controller.ts': `
import { Controller, Get } from './nest-common.js';
import type { ProductResponse } from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponse {
    return { id: 1, name: 'Product', publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toContain(
      '_nestmStandardSchema.StandardSchemaResponse(ProductResponse)',
    );
  });

  it('promotes default and named schema classes from the same type-only import', () => {
    const result = compileFixture({
      'mixed.schemas.ts': `
import { createResponseSchemaClass } from '@nestm/standard-schema';
import { z } from 'zod';

const ResponseSchema = z.object({ id: z.number() });

export default class DefaultResponse extends createResponseSchemaClass(
  ResponseSchema,
) {}

export class NamedResponse extends createResponseSchemaClass(
  ResponseSchema,
) {}
`,
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import DefaultResponse, {
  type NamedResponse,
} from './mixed.schemas.js';

@Controller('products')
export class ProductsController {
  @Get('default')
  defaultResponse(): DefaultResponse {
    return { id: 1 };
  }

  @Get('named')
  namedResponse(): NamedResponse {
    return { id: 2 };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toMatch(
      /import DefaultResponse, \{ NamedResponse \} from ['"]\.\/mixed\.schemas\.js['"];/,
    );
    expect(javascript).toContain('StandardSchemaResponse(DefaultResponse)');
    expect(javascript).toContain('StandardSchemaResponse(NamedResponse)');
  });

  it('promotes an anonymous default response schema class', () => {
    const result = compileFixture({
      'anonymous.schemas.ts': `
import { createResponseSchemaClass } from '@nestm/standard-schema';
import { z } from 'zod';

const ResponseSchema = z.object({ id: z.number() });

export default class extends createResponseSchemaClass(ResponseSchema) {}
`,
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type ProductResponse from './anonymous.schemas.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponse {
    return { id: 1 };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toMatch(
      /import ProductResponse from ['"]\.\/anonymous\.schemas\.js['"];/,
    );
    expect(javascript).toContain(
      '_nestmStandardSchema.StandardSchemaResponse(ProductResponse)',
    );
  });

  it('lets explicit metadata win and skips routes without a serializable body', () => {
    const result = compileFixture({
      'product.schemas.ts': schemaClassSource,
      'products.controller.ts': `
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Res,
  SerializeOptions,
  StreamableFile,
} from '@nestjs/common';
import {
  StandardSchemaResponse,
} from '@nestm/standard-schema';
import {
  ProductResponse,
  ProductInput,
} from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Get('inferred')
  inferred(): ProductResponse {
    return { id: 1, name: 'Inferred', publishedAt: new Date() };
  }

  @Get('explicit')
  @StandardSchemaResponse(ProductResponse)
  explicit(): ProductResponse {
    return { id: 2, name: 'Explicit', publishedAt: new Date() };
  }

  @Get('native')
  @SerializeOptions({ schema: ProductResponse.schema })
  native(): ProductResponse {
    return { id: 3, name: 'Native', publishedAt: new Date() };
  }

  @Get('empty')
  empty(): void {}

  @Get('async-empty')
  async asyncEmpty(): Promise<void> {}

  @Get('no-content')
  @HttpCode(HttpStatus.NO_CONTENT)
  noContent(): ProductResponse {
    return { id: 4, name: 'No content', publishedAt: new Date() };
  }

  @Get('raw')
  raw(@Res() _response: unknown): ProductResponse {
    return { id: 5, name: 'Raw', publishedAt: new Date() };
  }

  @Get('request-schema-class')
  requestSchemaClass(): ProductInput {
    return { name: 'Request' };
  }

  @Get('file')
  file(): StreamableFile {
    throw new Error('not executed');
  }

  @Get('primitive')
  primitive(): string {
    return 'ok';
  }

  @Get('unannotated')
  unannotated() {
    return { id: 6 };
  }

  helper(): ProductResponse {
    return { id: 7, name: 'Helper', publishedAt: new Date() };
  }
}

@Controller('explicit-controller')
@StandardSchemaResponse(ProductResponse)
export class ExplicitController {
  @Get()
  find(): ProductResponse {
    return { id: 8, name: 'Controller', publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(
      countOccurrences(
        javascript,
        '_nestmStandardSchema.StandardSchemaResponse(ProductResponse)',
      ),
    ).toBe(1);
    expect(
      countOccurrences(javascript, 'StandardSchemaResponse(ProductResponse)'),
    ).toBe(3);
  });

  it('documents an explicit StandardSchemaResponse instead of leaving it undocumented', () => {
    // `@StandardSchemaResponse` is `@SerializeOptions` underneath: it drives serialization and
    // emits no Swagger metadata. Because it also counts as an explicit contract, inference skips
    // the method — so before this, an annotated route produced `200: { description: '' }` with no
    // schema at all. `ApiStandardSchemaResponse(source)` applies the very same
    // `StandardSchemaResponse(source, {})` plus `ApiResponse`, so serialization is unchanged.
    const result = compileFixture(
      {
        'product.schemas.ts': schemaClassSource,
        'products.controller.ts': `
import { Controller, Get, Post } from '@nestjs/common';
import { StandardSchemaResponse } from '@nestm/standard-schema';
import { ApiStandardSchemaResponse } from '@nestm/standard-schema/swagger';
import { ProductResponse, OtherProductResponse } from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Get('documented')
  @StandardSchemaResponse(ProductResponse)
  documented() {
    return { id: 1, name: 'Documented', publishedAt: new Date() };
  }

  @Get('already-documented')
  @ApiStandardSchemaResponse(OtherProductResponse)
  alreadyDocumented() {
    return { id: 2, name: 'Hand written', publishedAt: new Date() };
  }

  @Post('with-options')
  @StandardSchemaResponse(ProductResponse, { validateOptions: {} })
  withOptions() {
    return { id: 3, name: 'Options', publishedAt: new Date() };
  }

  @Post('created')
  @StandardSchemaResponse(ProductResponse)
  created() {
    return { id: 4, name: 'Created', publishedAt: new Date() };
  }
}
`,
      },
      { pluginOptions: { swagger: true } },
    );
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');

    // Upgraded WITH a status, and the runtime-only form is gone from that route. The status is
    // what keeps the schema off the `default` response key, where generators read it as the error
    // type and leave the success response untyped.
    expect(javascript).toContain(
      '_nestmStandardSchemaSwagger.ApiStandardSchemaResponse(ProductResponse, { status: 200 })',
    );
    // @Post carries Nest's 201, matching what the inference path derives.
    expect(javascript).toContain(
      '_nestmStandardSchemaSwagger.ApiStandardSchemaResponse(ProductResponse, { status: 201 })',
    );

    // A hand-written swagger decorator is authoritative and must not be duplicated.
    expect(
      countOccurrences(
        javascript,
        'ApiStandardSchemaResponse(OtherProductResponse)',
      ),
    ).toBe(1);

    // Two arguments partition options differently between the two decorators, so rewriting could
    // move a serialization key into the document. Left exactly as written.
    expect(javascript).toContain(
      'StandardSchemaResponse(ProductResponse, { validateOptions: {} })',
    );
    expect(javascript).not.toContain(
      'ApiStandardSchemaResponse(ProductResponse, { validateOptions: {} })',
    );
  });

  it('never guesses a status it cannot know, and never fails the build for it', () => {
    // Every case here backs off to the untouched runtime decorator. That is a SAFE fallback:
    // with no response metadata at all, @nestjs/swagger's explorer emits the correct 200/201 key
    // itself. The `default` key is what suppresses that fallback, which is why "skip the rewrite"
    // is the right escape hatch and "rewrite without a status" is not.
    const result = compileFixture(
      {
        'product.schemas.ts': schemaClassSource,
        'products.controller.ts': `
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Redirect,
  Res,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { StandardSchemaResponse } from '@nestm/standard-schema';
import { ProductResponse, OtherProductResponse } from './product.schemas.js';

declare const RUNTIME_STATUS: number;

@Controller('products')
export class ProductsController {
  @Get('raw')
  @StandardSchemaResponse(ProductResponse)
  raw(@Res() _response: unknown) {
    return { id: 1, name: 'Raw', publishedAt: new Date() };
  }

  @Get('redirect')
  @Redirect('https://example.com', 301)
  @StandardSchemaResponse(ProductResponse)
  redirect() {
    return { id: 2, name: 'Redirect', publishedAt: new Date() };
  }

  @Delete('no-content')
  @HttpCode(HttpStatus.NO_CONTENT)
  @StandardSchemaResponse(ProductResponse)
  noContent() {
    return { id: 3, name: 'NoContent', publishedAt: new Date() };
  }

  @Get('dynamic-status')
  @HttpCode(RUNTIME_STATUS)
  @StandardSchemaResponse(ProductResponse)
  dynamicStatus() {
    return { id: 4, name: 'Dynamic', publishedAt: new Date() };
  }

  @Get('already-swaggered')
  @ApiOkResponse({ type: OtherProductResponse, description: 'Hand written.' })
  @StandardSchemaResponse(ProductResponse)
  alreadySwaggered() {
    return { id: 5, name: 'Swaggered', publishedAt: new Date() };
  }
}
`,
      },
      { pluginOptions: { swagger: true } },
    );
    const javascript = getOutput(result.emitted, 'products.controller.js');

    // A dynamic @HttpCode must not fail the build. These methods are invisible to preflight
    // (it skips anything carrying an explicit response decorator), so a throw would escape
    // mid-transform, unaggregated, telling the author to add a decorator they already have.
    expect(formatDiagnostics(result.diagnostics)).toBe('');

    // Not one of the five was rewritten.
    expect(javascript).not.toContain('ApiStandardSchemaResponse');
    expect(
      countOccurrences(javascript, 'StandardSchemaResponse(ProductResponse)'),
    ).toBe(5);

    // And the hand-written Swagger contract survives intact. Sharing its response key would let
    // ResponseObjectFactory's standardSchema short-circuit drop `type` — silently, and in a way
    // decorator order cannot fix.
    expect(javascript).toContain('type: OtherProductResponse');
  });

  it('derives the status the same way the inference path does', () => {
    const result = compileFixture(
      {
        'product.schemas.ts': schemaClassSource,
        'products.controller.ts': `
import { Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { StandardSchemaResponse } from '@nestm/standard-schema';
import { ProductResponse } from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Get('read')
  @StandardSchemaResponse(ProductResponse)
  read() {
    return { id: 1, name: 'Read', publishedAt: new Date() };
  }

  @Post('create')
  @StandardSchemaResponse(ProductResponse)
  create() {
    return { id: 2, name: 'Create', publishedAt: new Date() };
  }

  @Patch('update')
  @StandardSchemaResponse(ProductResponse)
  update() {
    return { id: 3, name: 'Update', publishedAt: new Date() };
  }

  @Get('accepted')
  @HttpCode(HttpStatus.ACCEPTED)
  @StandardSchemaResponse(ProductResponse)
  accepted() {
    return { id: 4, name: 'Accepted', publishedAt: new Date() };
  }
}
`,
      },
      { pluginOptions: { swagger: true } },
    );
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    // @Get and @Patch -> 200, @Post -> 201, @HttpCode wins over the verb.
    expect(countOccurrences(javascript, '{ status: 200 }')).toBe(2);
    expect(countOccurrences(javascript, '{ status: 201 }')).toBe(1);
    expect(countOccurrences(javascript, '{ status: 202 }')).toBe(1);
  });

  it('leaves StandardSchemaResponse alone when swagger output is disabled', () => {
    const result = compileFixture({
      'product.schemas.ts': schemaClassSource,
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import { StandardSchemaResponse } from '@nestm/standard-schema';
import { ProductResponse } from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Get()
  find() {
    return { id: 1, name: 'Plain', publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).not.toContain('ApiStandardSchemaResponse');
  });

  it('does not treat unrelated local decorators as explicit response metadata', () => {
    const result = compileFixture({
      'product.schemas.ts': schemaClassSource,
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponse } from './product.schemas.js';

function SerializeOptions(): ClassDecorator & MethodDecorator {
  return () => undefined;
}

function StandardSchemaResponse(): ClassDecorator & MethodDecorator {
  return () => undefined;
}

@Controller('products')
@StandardSchemaResponse()
export class ProductsController {
  @Get()
  @SerializeOptions()
  find(): ProductResponse {
    return { id: 1, name: 'Product', publishedAt: new Date() };
  }
}

@Controller('other-products')
@SerializeOptions()
export class OtherProductsController {
  @Get()
  @StandardSchemaResponse()
  find(): ProductResponse {
    return { id: 2, name: 'Other product', publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(
      countOccurrences(
        javascript,
        '_nestmStandardSchema.StandardSchemaResponse(ProductResponse)',
      ),
    ).toBe(2);
  });

  it('infers passthrough responses while continuing to skip raw responses', () => {
    const result = compileFixture({
      'product.schemas.ts': schemaClassSource,
      'products.controller.ts': `
import { Controller, Get, Res } from '@nestjs/common';
import type { ProductResponse } from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Get('passthrough')
  passthrough(@Res({ passthrough: true }) _response: unknown): ProductResponse {
    return { id: 1, name: 'Passthrough', publishedAt: new Date() };
  }

  @Get('raw')
  raw(@Res() _response: unknown): ProductResponse {
    return { id: 2, name: 'Raw', publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(
      countOccurrences(
        javascript,
        '_nestmStandardSchema.StandardSchemaResponse(ProductResponse)',
      ),
    ).toBe(1);
  });

  it.each([
    {
      name: 'union',
      declaration: 'find(): ProductResponse | OtherProductResponse',
      reason: 'union response types',
    },
    {
      name: 'nested array',
      declaration: 'find(): ProductResponse[][]',
      reason: 'nested Promise or array response types',
    },
    {
      name: 'tuple',
      declaration: 'find(): [ProductResponse]',
      reason: 'tuple response types',
    },
    {
      name: 'readonly tuple',
      declaration: 'find(): readonly [ProductResponse]',
      reason: 'tuple response types',
    },
    {
      name: 'structural envelope',
      prelude: 'type Page<T> = { data: T[] };',
      declaration: 'find(): Page<ProductResponse>',
      reason: 'response envelopes and generic wrappers',
    },
    {
      name: 'intersection',
      declaration: 'find(): ProductResponse & { readonly extra: string }',
      reason: 'intersection response types',
    },
  ])(
    'fails before emit for an ambiguous $name contract',
    ({ declaration, prelude = '', reason }) => {
      expect(() =>
        compileFixture({
          'product.schemas.ts': schemaClassSource,
          'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type {
  OtherProductResponse,
  ProductResponse,
} from './product.schemas.js';

${prelude}

@Controller('products')
export class ProductsController {
  @Get()
  ${declaration} {
    throw new Error('not executed');
  }
}
`,
        }),
      ).toThrow(reason);
    },
  );

  it('fails before emit for an unresolved generic response', () => {
    expect(() =>
      compileFixture({
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';

@Controller('products')
export class ProductsController {
  @Get()
  find<T>(): T {
    throw new Error('not executed');
  }
}
`,
      }),
    ).toThrow('unresolved generic response types');
  });

  it.each([
    {
      name: 'Promise',
      wrapper: 'interface Promise<T> { readonly value: T; }',
    },
    {
      name: 'Array',
      wrapper: 'interface Array<T> { readonly values: T[]; }',
    },
  ])(
    'does not unwrap a locally shadowed $name response wrapper',
    ({ name, wrapper }) => {
      expect(() =>
        compileFixture({
          'product.schemas.ts': schemaClassSource,
          'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponse } from './product.schemas.js';

${wrapper}

@Controller('products')
export class ProductsController {
  @Get()
  find(): ${name}<ProductResponse> {
    throw new Error('not executed');
  }
}
`,
        }),
      ).toThrow('response envelopes and generic wrappers');
    },
  );

  it('aggregates ambiguous contracts during preflight', () => {
    expect(() =>
      compileFixture({
        'product.schemas.ts': schemaClassSource,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type {
  OtherProductResponse,
  ProductResponse,
} from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Get('union')
  union(): ProductResponse | OtherProductResponse {
    throw new Error('not executed');
  }

  @Get('nested')
  nested(): ProductResponse[][] {
    throw new Error('not executed');
  }
}
`,
      }),
    ).toThrow('found 2 ambiguous response contracts');
  });

  it.each([
    `export type { ProductResponse } from './product.schemas.js';`,
    `export type * from './product.schemas.js';`,
  ])('rejects promotion through a type-only re-export', (barrelSource) => {
    expect(() =>
      compileFixture({
        'product.schemas.ts': schemaClassSource,
        'product.barrel.ts': barrelSource,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponse } from './product.barrel.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponse {
    throw new Error('not executed');
  }
}
`,
      }),
    ).toThrow('cannot be referenced safely at runtime');
  });

  it('rejects elidable imports whose module only exports a type', () => {
    expect(() =>
      compileFixture(
        {
          'product.schemas.ts': schemaClassSource,
          'product.barrel.ts': `
export type { ProductResponse } from './product.schemas.js';
`,
          'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import { ProductResponse } from './product.barrel.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponse {
    throw new Error('not executed');
  }
}
`,
        },
        {
          compilerOptions: {
            verbatimModuleSyntax: false,
          },
        },
      ),
    ).toThrow('cannot be referenced safely at runtime');
  });

  it('rejects ambient response classes declared in implementation files', () => {
    expect(() =>
      compileFixture({
        'ghost.schemas.ts': `
import { STANDARD_SCHEMA_RESPONSE_CLASS } from '@nestm/standard-schema';

export declare class GhostResponse {
  static readonly [STANDARD_SCHEMA_RESPONSE_CLASS]: true;
  readonly id: number;
}
`,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { GhostResponse } from './ghost.schemas.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): GhostResponse {
    throw new Error('not executed');
  }
}
`,
      }),
    ).toThrow('cannot be referenced safely at runtime');
  });

  it('rejects a separately exported ambient response class', () => {
    expect(() =>
      compileFixture({
        'ghost.schemas.ts': `
import { STANDARD_SCHEMA_RESPONSE_CLASS } from '@nestm/standard-schema';

declare class GhostResponse {
  static readonly [STANDARD_SCHEMA_RESPONSE_CLASS]: true;
  readonly id: number;
}

export { GhostResponse };
`,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { GhostResponse } from './ghost.schemas.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): GhostResponse {
    throw new Error('not executed');
  }
}
`,
      }),
    ).toThrow('cannot be referenced safely at runtime');
  });

  it('rejects a local ambient response class before its controller', () => {
    expect(() =>
      compileFixture({
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import { STANDARD_SCHEMA_RESPONSE_CLASS } from '@nestm/standard-schema';

declare class GhostResponse {
  static readonly [STANDARD_SCHEMA_RESPONSE_CLASS]: true;
  readonly id: number;
}

@Controller('products')
export class ProductsController {
  @Get()
  find(): GhostResponse {
    throw new Error('not executed');
  }
}
`,
      }),
    ).toThrow('cannot be referenced safely at runtime');
  });

  it('rejects an erased local type import re-exported as a value', () => {
    expect(() =>
      compileFixture(
        {
          'product.schemas.ts': schemaClassSource,
          'product.barrel.ts': `
import type { ProductResponse } from './product.schemas.js';

export { ProductResponse };
`,
          'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponse } from './product.barrel.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponse {
    throw new Error('not executed');
  }
}
`,
        },
        {
          compilerOptions: {
            verbatimModuleSyntax: false,
          },
        },
      ),
    ).toThrow('cannot be referenced safely at runtime');
  });

  it('rejects split type and value exports with different identities', () => {
    expect(() =>
      compileFixture({
        'product.schemas.ts': schemaClassSource,
        'product.value.ts': `
export const ProductResponse = class UnrelatedRuntimeValue {};
`,
        'product.barrel.ts': `
export type { ProductResponse } from './product.schemas.js';
export { ProductResponse } from './product.value.js';
`,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponse } from './product.barrel.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponse {
    throw new Error('not executed');
  }
}
`,
      }),
    ).toThrow('cannot be referenced safely at runtime');
  });

  it('promotes a response schema class through a safe runtime barrel re-export', () => {
    const result = compileFixture({
      'product.schemas.ts': schemaClassSource,
      'product.barrel.ts': `
export { ProductResponse } from './product.schemas.js';
`,
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponse } from './product.barrel.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponse {
    return { id: 1, name: 'Product', publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toMatch(
      /import \{ ProductResponse \} from ['"]\.\/product\.barrel\.js['"];/,
    );
    expect(javascript).toContain(
      '_nestmStandardSchema.StandardSchemaResponse(ProductResponse)',
    );
  });

  it('removes type-only resolution-mode attributes from promoted imports', () => {
    const result = compileFixture({
      'product.schemas.mts': schemaClassSource,
      'products.controller.mts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponse } from './product.schemas.mjs' with {
  'resolution-mode': 'import',
};

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponse {
    return { id: 1, name: 'Product', publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.mjs');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toMatch(
      /import \{ ProductResponse \} from ['"]\.\/product\.schemas\.mjs['"];/,
    );
    expect(javascript).not.toContain('resolution-mode');
  });

  it('does not infer unrelated classes with a lookalike local brand', () => {
    const result = compileFixture({
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';

const STANDARD_SCHEMA_RESPONSE_CLASS: unique symbol = Symbol('lookalike');

class FakeResponse {
  static readonly [STANDARD_SCHEMA_RESPONSE_CLASS] = true;
}

@Controller('products')
export class ProductsController {
  @Get()
  find(): FakeResponse {
    return {};
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).not.toContain('_nestmStandardSchema');
    expect(javascript).not.toContain('StandardSchemaResponse(FakeResponse)');
  });

  it('adds native request schemas and enriches existing Swagger success descriptions', () => {
    const result = compileFixture(
      {
        'product.schemas.ts': schemaClassSource,
        'products.controller.ts': `
import {
  Body as Payload,
  Controller as ApiController,
  Get as Read,
  HttpCode,
  HttpStatus,
  Param as RouteParams,
  Post as Create,
  Query as Search,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiResponse,
} from '@nestjs/swagger';
import type {
  ProductLookup,
  ProductResponse,
  ProductInput,
} from './product.schemas.js';

@ApiController('products')
export class ProductsController {
  @Create()
  @ApiCreatedResponse({ description: 'Product created.' })
  create(@Payload() body: ProductInput): ProductResponse {
    return { id: 1, name: body.name, publishedAt: new Date() };
  }

  @Read()
  @ApiOkResponse({ description: 'Products listed.' })
  findAll(@Search() query: ProductLookup): ProductResponse[] {
    return query.id === undefined ? [] : [];
  }

  @Read(':id')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Product accepted.',
  })
  findOne(@RouteParams() params: ProductLookup): ProductResponse {
    return { id: params.id, name: 'Product', publishedAt: new Date() };
  }
}
`,
      },
      {
        pluginOptions: {
          swagger: true,
        },
      },
    );
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toMatch(
      /Payload\(\{\s*schema: ProductInput\.schema\s*\}\)/,
    );
    expect(javascript).toMatch(
      /Search\(\{\s*schema: ProductLookup\.schema\s*\}\)/,
    );
    expect(javascript).toMatch(
      /RouteParams\(\{\s*schema: ProductLookup\.schema\s*\}\)/,
    );
    expect(javascript).toContain(
      "ApiCreatedResponse({ description: 'Product created.' })",
    );
    expect(javascript).toContain(
      "ApiOkResponse({ description: 'Products listed.' })",
    );
    expect(javascript).toMatch(
      /ApiResponse\(\{\s*status: HttpStatus\.ACCEPTED,\s*description: ['"]Product accepted\.['"],?\s*\}\)/,
    );
    expect(
      countOccurrences(
        javascript,
        '_nestmStandardSchemaSwagger.ApiStandardSchemaResponse(ProductResponse',
      ),
    ).toBe(3);
    expect(javascript).toMatch(
      /ApiStandardSchemaResponse\(ProductResponse, \{\s*status: 201\s*\}\)/,
    );
    expect(javascript).toMatch(
      /ApiStandardSchemaResponse\(ProductResponse, \{\s*status: 200,\s*isArray: true\s*\}\)/,
    );
    expect(javascript).toMatch(
      /ApiStandardSchemaResponse\(ProductResponse, \{\s*status: 202\s*\}\)/,
    );
  });

  it('injects the composite Swagger decorator with Nest default statuses and array shape', () => {
    const result = compileFixture(
      {
        'product.schemas.ts': schemaClassSource,
        'products.controller.ts': `
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  RequestMapping,
  RequestMethod,
} from '@nestjs/common';
import { ApiDefaultResponse } from '@nestjs/swagger';
import type { ProductResponse } from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Post()
  create(): ProductResponse {
    return { id: 1, name: 'Created', publishedAt: new Date() };
  }

  @RequestMapping({ method: RequestMethod.POST, path: 'mapped' })
  mappedPost(): ProductResponse {
    return { id: 4, name: 'Mapped', publishedAt: new Date() };
  }

  @Get()
  findAll(): Promise<readonly ProductResponse[]> {
    return Promise.resolve([]);
  }

  @Get('accepted')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiDefaultResponse({ description: 'Unexpected failure.' })
  accepted(): ProductResponse {
    return { id: 2, name: 'Accepted', publishedAt: new Date() };
  }
}
`,
      },
      {
        pluginOptions: {
          swagger: true,
        },
      },
    );
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toContain(
      'import * as _nestmStandardSchemaSwagger from "@nestm/standard-schema/swagger";',
    );
    expect(javascript).toMatch(
      /ApiStandardSchemaResponse\(ProductResponse, \{\s*status: 201\s*\}\)/,
    );
    expect(
      countOccurrences(
        javascript,
        'ApiStandardSchemaResponse(ProductResponse, { status: 201 })',
      ),
    ).toBe(2);
    expect(javascript).toMatch(
      /ApiStandardSchemaResponse\(ProductResponse, \{\s*status: 200,\s*isArray: true\s*\}\)/,
    );
    expect(javascript).toMatch(
      /ApiStandardSchemaResponse\(ProductResponse, \{\s*status: 202\s*\}\)/,
    );
    expect(javascript).toContain(
      "ApiDefaultResponse({ description: 'Unexpected failure.' })",
    );
    expect(javascript).not.toContain(
      '_nestmStandardSchema.StandardSchemaResponse',
    );
  });

  it('preserves explicit request, serialization, composite, and Swagger schemas', () => {
    const result = compileFixture(
      {
        'product.schemas.ts': schemaClassSource,
        'products.controller.ts': `
import {
  Body,
  Controller,
  Get,
  SerializeOptions,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { ApiStandardSchemaResponse } from '@nestm/standard-schema/swagger';
import {
  OtherProductResponse,
  ProductResponse,
  ProductInput,
} from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Get('request')
  explicitRequest(
    @Body({ schema: ProductInput.schema }) body: ProductInput,
  ): string {
    return body.name;
  }

  @Get('native')
  @SerializeOptions({ schema: ProductResponse.schema })
  native(): ProductResponse {
    return { id: 1, name: 'Native', publishedAt: new Date() };
  }

  @Get('swagger-schema')
  @ApiOkResponse({
    description: 'Explicit schema.',
    schema: { type: 'string' },
  })
  swaggerSchema(): ProductResponse {
    return { id: 2, name: 'Swagger', publishedAt: new Date() };
  }

  @Get('composite')
  @ApiStandardSchemaResponse(ProductResponse, {
    description: 'Explicit composite.',
    status: 200,
  })
  composite(): ProductResponse | OtherProductResponse {
    return { id: 3, name: 'Composite', publishedAt: new Date() };
  }
}
`,
      },
      {
        pluginOptions: {
          swagger: true,
        },
      },
    );
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(countOccurrences(javascript, 'schema: ProductInput.schema')).toBe(1);
    expect(javascript).toMatch(
      /ApiOkResponse\(\{\s*description: ['"]Explicit schema\.['"],\s*schema: \{ type: ['"]string['"] \},?\s*\}\)/,
    );
    expect(
      countOccurrences(
        javascript,
        '_nestmStandardSchema.StandardSchemaResponse(ProductResponse)',
      ),
    ).toBe(1);
    expect(
      countOccurrences(javascript, 'ApiStandardSchemaResponse(ProductResponse'),
    ).toBe(1);
  });

  it.each([
    {
      name: 'property-bound parameter',
      parameter: "@Param('id') input: ProductInput",
      reason: 'property-bound request decorators',
    },
    {
      name: 'request union',
      parameter: '@Body() input: ProductInput | ProductLookup',
      reason: 'request unions, wrappers, tuples, and arrays',
    },
    {
      name: 'request wrapper',
      parameter: '@Query() input: Array<ProductInput>',
      reason: 'request unions, wrappers, tuples, and arrays',
    },
    {
      name: 'nested request array',
      parameter: '@Body() input: ProductInput[][]',
      reason: 'request unions, wrappers, tuples, and arrays',
    },
  ])(
    'fails before emit for an ambiguous $name contract with Swagger inference',
    ({ parameter, reason }) => {
      expect(() =>
        compileFixture(
          {
            'product.schemas.ts': schemaClassSource,
            'products.controller.ts': `
import { Body, Controller, Param, Post, Query } from '@nestjs/common';
import type {
  ProductLookup,
  ProductInput,
} from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Post()
  create(${parameter}): string {
    return 'ok';
  }
}
`,
          },
          {
            pluginOptions: {
              swagger: true,
            },
          },
        ),
      ).toThrow(reason);
    },
  );

  it('fails before emit when a Standard Schema response status is unresolved', () => {
    expect(() =>
      compileFixture(
        {
          'product.schemas.ts': schemaClassSource,
          'products.controller.ts': `
import { Controller, Get, HttpCode } from '@nestjs/common';
import type { ProductResponse } from './product.schemas.js';

declare function resolveStatus(): number;

@Controller('products')
export class ProductsController {
  @Get()
  @HttpCode(resolveStatus())
  find(): ProductResponse {
    return { id: 1, name: 'Product', publishedAt: new Date() };
  }
}
`,
        },
        {
          pluginOptions: {
            swagger: true,
          },
        },
      ),
    ).toThrow('response status from @HttpCode cannot be resolved statically');
  });

  it('can skip ambiguous contracts when explicitly configured', () => {
    const result = compileFixture(
      {
        'product.schemas.ts': schemaClassSource,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type {
  OtherProductResponse,
  ProductResponse,
} from './product.schemas.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponse | OtherProductResponse {
    throw new Error('not executed');
  }
}
`,
      },
      {
        pluginOptions: {
          onAmbiguous: 'skip',
        },
      },
    );
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).not.toContain('StandardSchemaResponse');
    expect(javascript).not.toContain('_nestmStandardSchema');
  });

  it('supports a configurable controller suffix and .mts controllers', () => {
    const defaultResult = compileFixture({
      'product.schemas.ts': schemaClassSource,
      'products.api.ts': createSimpleControllerSource('./product.schemas.js'),
    });
    const customResult = compileFixture(
      {
        'product.schemas.ts': schemaClassSource,
        'products.api.ts': createSimpleControllerSource('./product.schemas.js'),
      },
      {
        pluginOptions: {
          controllerFileNameSuffix: ['.api.ts'],
        },
      },
    );
    const mtsResult = compileFixture({
      'product.schemas.mts': schemaClassSource,
      'products.controller.mts': createSimpleControllerSource(
        './product.schemas.mjs',
      ),
    });

    expect(getOutput(defaultResult.emitted, 'products.api.js')).not.toContain(
      'StandardSchemaResponse',
    );
    expect(getOutput(customResult.emitted, 'products.api.js')).toContain(
      'StandardSchemaResponse(ProductResponse)',
    );
    expect(getOutput(mtsResult.emitted, 'products.controller.mjs')).toContain(
      'StandardSchemaResponse(ProductResponse)',
    );
  });

  it('is idempotent when the transformer is registered more than once', () => {
    const files = {
      'product.schemas.ts': schemaClassSource,
      'products.controller.ts': createSimpleControllerSource(
        './product.schemas.js',
      ),
    };
    const once = compileFixture(files);
    const twice = compileFixture(files, { transformerPasses: 2 });
    const onceWithSwagger = compileFixture(files, {
      pluginOptions: {
        swagger: true,
      },
    });
    const twiceWithSwagger = compileFixture(files, {
      pluginOptions: {
        swagger: true,
      },
      transformerPasses: 2,
    });

    expect(getOutput(twice.emitted, 'products.controller.js')).toBe(
      getOutput(once.emitted, 'products.controller.js'),
    );
    expect(getOutput(twiceWithSwagger.emitted, 'products.controller.js')).toBe(
      getOutput(onceWithSwagger.emitted, 'products.controller.js'),
    );
  });

  it('validates its loader contract and options', () => {
    const require = createRequire(import.meta.url);
    const loaded = require(
      require.resolve('@nestm/standard-schema/plugin'),
    ) as {
      before(options?: Record<string, unknown>, program?: ts.Program): unknown;
    };

    expect(() => loaded.before()).toThrow('requires the Nest tsc builder');
    expect(() => loaded.before({ onAmbiguous: 'ignore' })).toThrow(
      'must be "error" or "skip"',
    );
    expect(() => loaded.before({ controllerFileNameSuffix: [] })).toThrow(
      'must be a non-empty string array',
    );
    expect(() => loaded.before({ swagger: 'yes' })).toThrow(
      'option "swagger" must be a boolean',
    );
  });
});

function createSimpleControllerSource(schemaClassImport: string): string {
  return `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponse } from '${schemaClassImport}';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponse {
    return { id: 1, name: 'Product', publishedAt: new Date() };
  }
}
`;
}

function getOutput(
  emitted: ReadonlyMap<string, string>,
  fileName: string,
): string {
  const output = emitted.get(fileName);

  if (output === undefined) {
    throw new Error(`Expected compiler output ${fileName}`);
  }

  return output;
}

function countOccurrences(value: string, search: string): number {
  return value.split(search).length - 1;
}
