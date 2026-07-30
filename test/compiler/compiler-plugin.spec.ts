import { createRequire } from 'node:module';

import type ts from 'typescript';

import { compileFixture, formatDiagnostics } from './compile-fixture.js';

const responseDtoSource = `
import {
  createStandardSchemaDto,
  createStandardSchemaResponseDto,
} from '@nestm/standard-schema';
import { z } from 'zod';

const ProductResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
  publishedAt: z.date().transform((value) => value.toISOString()),
});

export class ProductResponseDto extends createStandardSchemaResponseDto(
  ProductResponseSchema,
) {}

export class OtherProductResponseDto extends createStandardSchemaResponseDto(
  ProductResponseSchema,
) {}

export class RequestDto extends createStandardSchemaDto(
  z.object({ name: z.string() }),
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
  ProductResponseDto,
  UnusedType,
} from './product.dto.js';

@Controller('products')
export class ProductsController {
  @Get('direct')
  direct(): ProductResponseDto {
    return { id: 1, name: 'Direct', publishedAt: new Date() };
  }

  @Get('async')
  async asyncOne(): Promise<ProductResponseDto> {
    return { id: 2, name: 'Async', publishedAt: new Date() };
  }

  @Get('array')
  array(): ProductResponseDto[] {
    return [];
  }

  @Get('generic-array')
  genericArray(): Array<ProductResponseDto> {
    return [];
  }

  @Get('async-array')
  async asyncArray(): Promise<ProductResponseDto[]> {
    return [];
  }

  @Get('readonly-array')
  readonlyArray(): readonly ProductResponseDto[] {
    return [];
  }

  @Get('async-readonly-array')
  async asyncReadonlyArray(): Promise<readonly ProductResponseDto[]> {
    return [];
  }
}
`;
    const baseline = compileFixture(
      {
        'product.dto.ts': responseDtoSource,
        'products.controller.ts': controllerSource,
      },
      { usePlugin: false },
    );
    const transformed = compileFixture({
      'product.dto.ts': responseDtoSource,
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
      /import \{ ProductResponseDto \} from ['"]\.\/product\.dto\.js['"];/,
    );
    expect(javascript).not.toContain('UnusedType');
    expect(
      countOccurrences(
        javascript,
        '_nestmStandardSchema.StandardSchemaResponse(ProductResponseDto)',
      ),
    ).toBe(7);
    expect(transformedDeclaration).toBe(baselineDeclaration);
  });

  it('supports aliased decorators and type-only DTO imports without collisions', () => {
    const result = compileFixture({
      'product.dto.ts': responseDtoSource,
      'products.controller.ts': `
import {
  Controller as ApiController,
  Get as Read,
} from '@nestjs/common';
import type {
  ProductResponseDto as ProductDto,
} from './product.dto.js';

const _nestmStandardSchema = 'occupied';

@ApiController('products')
export class ProductsController {
  @Read()
  find(): ProductDto {
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
      /import \{ ProductResponseDto as ProductDto \} from ['"]\.\/product\.dto\.js['"];/,
    );
    expect(javascript).toContain(
      '_nestmStandardSchema2.StandardSchemaResponse(ProductDto)',
    );
  });

  it('recognizes Nest route decorators re-exported through a local barrel', () => {
    const result = compileFixture({
      'nest-common.ts': `
export { Controller, Get } from '@nestjs/common';
`,
      'product.dto.ts': responseDtoSource,
      'products.controller.ts': `
import { Controller, Get } from './nest-common.js';
import type { ProductResponseDto } from './product.dto.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponseDto {
    return { id: 1, name: 'Product', publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toContain(
      '_nestmStandardSchema.StandardSchemaResponse(ProductResponseDto)',
    );
  });

  it('promotes default and named DTOs from the same type-only import', () => {
    const result = compileFixture({
      'mixed.dto.ts': `
import { createStandardSchemaResponseDto } from '@nestm/standard-schema';
import { z } from 'zod';

const ResponseSchema = z.object({ id: z.number() });

export default class DefaultResponseDto extends createStandardSchemaResponseDto(
  ResponseSchema,
) {}

export class NamedResponseDto extends createStandardSchemaResponseDto(
  ResponseSchema,
) {}
`,
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import DefaultResponseDto, {
  type NamedResponseDto,
} from './mixed.dto.js';

@Controller('products')
export class ProductsController {
  @Get('default')
  defaultResponse(): DefaultResponseDto {
    return { id: 1 };
  }

  @Get('named')
  namedResponse(): NamedResponseDto {
    return { id: 2 };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toMatch(
      /import DefaultResponseDto, \{ NamedResponseDto \} from ['"]\.\/mixed\.dto\.js['"];/,
    );
    expect(javascript).toContain('StandardSchemaResponse(DefaultResponseDto)');
    expect(javascript).toContain('StandardSchemaResponse(NamedResponseDto)');
  });

  it('promotes an anonymous default response DTO class', () => {
    const result = compileFixture({
      'anonymous.dto.ts': `
import { createStandardSchemaResponseDto } from '@nestm/standard-schema';
import { z } from 'zod';

const ResponseSchema = z.object({ id: z.number() });

export default class extends createStandardSchemaResponseDto(ResponseSchema) {}
`,
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type ProductResponseDto from './anonymous.dto.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponseDto {
    return { id: 1 };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toMatch(
      /import ProductResponseDto from ['"]\.\/anonymous\.dto\.js['"];/,
    );
    expect(javascript).toContain(
      '_nestmStandardSchema.StandardSchemaResponse(ProductResponseDto)',
    );
  });

  it('lets explicit metadata win and skips routes without a serializable body', () => {
    const result = compileFixture({
      'product.dto.ts': responseDtoSource,
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
  ProductResponseDto,
  RequestDto,
} from './product.dto.js';

@Controller('products')
export class ProductsController {
  @Get('inferred')
  inferred(): ProductResponseDto {
    return { id: 1, name: 'Inferred', publishedAt: new Date() };
  }

  @Get('explicit')
  @StandardSchemaResponse(ProductResponseDto)
  explicit(): ProductResponseDto {
    return { id: 2, name: 'Explicit', publishedAt: new Date() };
  }

  @Get('native')
  @SerializeOptions({ schema: ProductResponseDto.schema })
  native(): ProductResponseDto {
    return { id: 3, name: 'Native', publishedAt: new Date() };
  }

  @Get('empty')
  empty(): void {}

  @Get('async-empty')
  async asyncEmpty(): Promise<void> {}

  @Get('no-content')
  @HttpCode(HttpStatus.NO_CONTENT)
  noContent(): ProductResponseDto {
    return { id: 4, name: 'No content', publishedAt: new Date() };
  }

  @Get('raw')
  raw(@Res() _response: unknown): ProductResponseDto {
    return { id: 5, name: 'Raw', publishedAt: new Date() };
  }

  @Get('request-dto')
  requestDto(): RequestDto {
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

  helper(): ProductResponseDto {
    return { id: 7, name: 'Helper', publishedAt: new Date() };
  }
}

@Controller('explicit-controller')
@StandardSchemaResponse(ProductResponseDto)
export class ExplicitController {
  @Get()
  find(): ProductResponseDto {
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
        '_nestmStandardSchema.StandardSchemaResponse(ProductResponseDto)',
      ),
    ).toBe(1);
    expect(
      countOccurrences(
        javascript,
        'StandardSchemaResponse(ProductResponseDto)',
      ),
    ).toBe(3);
  });

  it('does not treat unrelated local decorators as explicit response metadata', () => {
    const result = compileFixture({
      'product.dto.ts': responseDtoSource,
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponseDto } from './product.dto.js';

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
  find(): ProductResponseDto {
    return { id: 1, name: 'Product', publishedAt: new Date() };
  }
}

@Controller('other-products')
@SerializeOptions()
export class OtherProductsController {
  @Get()
  @StandardSchemaResponse()
  find(): ProductResponseDto {
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
        '_nestmStandardSchema.StandardSchemaResponse(ProductResponseDto)',
      ),
    ).toBe(2);
  });

  it('infers passthrough responses while continuing to skip raw responses', () => {
    const result = compileFixture({
      'product.dto.ts': responseDtoSource,
      'products.controller.ts': `
import { Controller, Get, Res } from '@nestjs/common';
import type { ProductResponseDto } from './product.dto.js';

@Controller('products')
export class ProductsController {
  @Get('passthrough')
  passthrough(@Res({ passthrough: true }) _response: unknown): ProductResponseDto {
    return { id: 1, name: 'Passthrough', publishedAt: new Date() };
  }

  @Get('raw')
  raw(@Res() _response: unknown): ProductResponseDto {
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
        '_nestmStandardSchema.StandardSchemaResponse(ProductResponseDto)',
      ),
    ).toBe(1);
  });

  it.each([
    {
      name: 'union',
      declaration: 'find(): ProductResponseDto | OtherProductResponseDto',
      reason: 'union response types',
    },
    {
      name: 'nested array',
      declaration: 'find(): ProductResponseDto[][]',
      reason: 'nested Promise or array response types',
    },
    {
      name: 'tuple',
      declaration: 'find(): [ProductResponseDto]',
      reason: 'tuple response types',
    },
    {
      name: 'readonly tuple',
      declaration: 'find(): readonly [ProductResponseDto]',
      reason: 'tuple response types',
    },
    {
      name: 'structural envelope',
      prelude: 'type Page<T> = { data: T[] };',
      declaration: 'find(): Page<ProductResponseDto>',
      reason: 'response envelopes and generic wrappers',
    },
    {
      name: 'intersection',
      declaration: 'find(): ProductResponseDto & { readonly extra: string }',
      reason: 'intersection response types',
    },
  ])(
    'fails before emit for an ambiguous $name contract',
    ({ declaration, prelude = '', reason }) => {
      expect(() =>
        compileFixture({
          'product.dto.ts': responseDtoSource,
          'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type {
  OtherProductResponseDto,
  ProductResponseDto,
} from './product.dto.js';

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
          'product.dto.ts': responseDtoSource,
          'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponseDto } from './product.dto.js';

${wrapper}

@Controller('products')
export class ProductsController {
  @Get()
  find(): ${name}<ProductResponseDto> {
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
        'product.dto.ts': responseDtoSource,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type {
  OtherProductResponseDto,
  ProductResponseDto,
} from './product.dto.js';

@Controller('products')
export class ProductsController {
  @Get('union')
  union(): ProductResponseDto | OtherProductResponseDto {
    throw new Error('not executed');
  }

  @Get('nested')
  nested(): ProductResponseDto[][] {
    throw new Error('not executed');
  }
}
`,
      }),
    ).toThrow('found 2 ambiguous response contracts');
  });

  it.each([
    `export type { ProductResponseDto } from './product.dto.js';`,
    `export type * from './product.dto.js';`,
  ])('rejects promotion through a type-only re-export', (barrelSource) => {
    expect(() =>
      compileFixture({
        'product.dto.ts': responseDtoSource,
        'product.barrel.ts': barrelSource,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponseDto } from './product.barrel.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponseDto {
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
          'product.dto.ts': responseDtoSource,
          'product.barrel.ts': `
export type { ProductResponseDto } from './product.dto.js';
`,
          'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import { ProductResponseDto } from './product.barrel.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponseDto {
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
        'ghost.dto.ts': `
import { STANDARD_SCHEMA_RESPONSE_DTO } from '@nestm/standard-schema';

export declare class GhostResponseDto {
  static readonly [STANDARD_SCHEMA_RESPONSE_DTO]: true;
  readonly id: number;
}
`,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { GhostResponseDto } from './ghost.dto.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): GhostResponseDto {
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
        'ghost.dto.ts': `
import { STANDARD_SCHEMA_RESPONSE_DTO } from '@nestm/standard-schema';

declare class GhostResponseDto {
  static readonly [STANDARD_SCHEMA_RESPONSE_DTO]: true;
  readonly id: number;
}

export { GhostResponseDto };
`,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { GhostResponseDto } from './ghost.dto.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): GhostResponseDto {
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
import { STANDARD_SCHEMA_RESPONSE_DTO } from '@nestm/standard-schema';

declare class GhostResponseDto {
  static readonly [STANDARD_SCHEMA_RESPONSE_DTO]: true;
  readonly id: number;
}

@Controller('products')
export class ProductsController {
  @Get()
  find(): GhostResponseDto {
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
          'product.dto.ts': responseDtoSource,
          'product.barrel.ts': `
import type { ProductResponseDto } from './product.dto.js';

export { ProductResponseDto };
`,
          'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponseDto } from './product.barrel.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponseDto {
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
        'product.dto.ts': responseDtoSource,
        'product.value.ts': `
export const ProductResponseDto = class UnrelatedRuntimeValue {};
`,
        'product.barrel.ts': `
export type { ProductResponseDto } from './product.dto.js';
export { ProductResponseDto } from './product.value.js';
`,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponseDto } from './product.barrel.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponseDto {
    throw new Error('not executed');
  }
}
`,
      }),
    ).toThrow('cannot be referenced safely at runtime');
  });

  it('promotes a response DTO through a safe runtime barrel re-export', () => {
    const result = compileFixture({
      'product.dto.ts': responseDtoSource,
      'product.barrel.ts': `
export { ProductResponseDto } from './product.dto.js';
`,
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponseDto } from './product.barrel.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponseDto {
    return { id: 1, name: 'Product', publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toMatch(
      /import \{ ProductResponseDto \} from ['"]\.\/product\.barrel\.js['"];/,
    );
    expect(javascript).toContain(
      '_nestmStandardSchema.StandardSchemaResponse(ProductResponseDto)',
    );
  });

  it('removes type-only resolution-mode attributes from promoted imports', () => {
    const result = compileFixture({
      'product.dto.mts': responseDtoSource,
      'products.controller.mts': `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponseDto } from './product.dto.mjs' with {
  'resolution-mode': 'import',
};

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponseDto {
    return { id: 1, name: 'Product', publishedAt: new Date() };
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.mjs');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).toMatch(
      /import \{ ProductResponseDto \} from ['"]\.\/product\.dto\.mjs['"];/,
    );
    expect(javascript).not.toContain('resolution-mode');
  });

  it('does not infer unrelated classes with a lookalike local brand', () => {
    const result = compileFixture({
      'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';

const STANDARD_SCHEMA_RESPONSE_DTO: unique symbol = Symbol('lookalike');

class FakeResponseDto {
  static readonly [STANDARD_SCHEMA_RESPONSE_DTO] = true;
}

@Controller('products')
export class ProductsController {
  @Get()
  find(): FakeResponseDto {
    return {};
  }
}
`,
    });
    const javascript = getOutput(result.emitted, 'products.controller.js');

    expect(formatDiagnostics(result.diagnostics)).toBe('');
    expect(javascript).not.toContain('_nestmStandardSchema');
    expect(javascript).not.toContain('StandardSchemaResponse(FakeResponseDto)');
  });

  it('can skip ambiguous contracts when explicitly configured', () => {
    const result = compileFixture(
      {
        'product.dto.ts': responseDtoSource,
        'products.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import type {
  OtherProductResponseDto,
  ProductResponseDto,
} from './product.dto.js';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponseDto | OtherProductResponseDto {
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
      'product.dto.ts': responseDtoSource,
      'products.api.ts': createSimpleControllerSource('./product.dto.js'),
    });
    const customResult = compileFixture(
      {
        'product.dto.ts': responseDtoSource,
        'products.api.ts': createSimpleControllerSource('./product.dto.js'),
      },
      {
        pluginOptions: {
          controllerFileNameSuffix: ['.api.ts'],
        },
      },
    );
    const mtsResult = compileFixture({
      'product.dto.mts': responseDtoSource,
      'products.controller.mts':
        createSimpleControllerSource('./product.dto.mjs'),
    });

    expect(getOutput(defaultResult.emitted, 'products.api.js')).not.toContain(
      'StandardSchemaResponse',
    );
    expect(getOutput(customResult.emitted, 'products.api.js')).toContain(
      'StandardSchemaResponse(ProductResponseDto)',
    );
    expect(getOutput(mtsResult.emitted, 'products.controller.mjs')).toContain(
      'StandardSchemaResponse(ProductResponseDto)',
    );
  });

  it('is idempotent when the transformer is registered more than once', () => {
    const files = {
      'product.dto.ts': responseDtoSource,
      'products.controller.ts':
        createSimpleControllerSource('./product.dto.js'),
    };
    const once = compileFixture(files);
    const twice = compileFixture(files, { transformerPasses: 2 });

    expect(getOutput(twice.emitted, 'products.controller.js')).toBe(
      getOutput(once.emitted, 'products.controller.js'),
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
  });
});

function createSimpleControllerSource(dtoImport: string): string {
  return `
import { Controller, Get } from '@nestjs/common';
import type { ProductResponseDto } from '${dtoImport}';

@Controller('products')
export class ProductsController {
  @Get()
  find(): ProductResponseDto {
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
