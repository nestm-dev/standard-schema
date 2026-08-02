import 'reflect-metadata';

import { DECORATORS } from '@nestjs/swagger';
import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from '@standard-schema/spec';
import { z } from 'zod';

import { createStandardSchemaResponseDto } from '../create-standard-schema-response-dto.js';
import {
  ApiStandardSchemaResponse,
  withStandardSchemaResponseArrays,
} from './api-standard-schema-response.decorator.js';

const CLASS_SERIALIZER_OPTIONS = 'class_serializer:options';

const ProductResponseSchema = z.object({
  id: z.number().int().positive(),
  publishedAt: z.string().datetime(),
});
const ConverterOnlyProductSchema: StandardSchemaV1 = {
  '~standard': {
    validate: (value) => ({ value }),
    vendor: 'converter-only',
    version: 1,
  },
};

class ProductResponseDto extends createStandardSchemaResponseDto(
  ProductResponseSchema,
) {}

describe(ApiStandardSchemaResponse.name, () => {
  it('combines native response serialization and Swagger metadata', () => {
    class TestController {
      @ApiStandardSchemaResponse(ProductResponseDto, {
        description: 'Products created by the request.',
        example: {
          id: 1,
          publishedAt: '2026-07-31T00:00:00.000Z',
        },
        isArray: true,
        status: 201,
        validateOptions: {
          libraryOptions: {
            locale: 'en',
          },
        },
      })
      create(): void {}
    }

    const handler = TestController.prototype.create;

    expect(Reflect.getMetadata(CLASS_SERIALIZER_OPTIONS, handler)).toEqual({
      schema: ProductResponseSchema,
      validateOptions: {
        libraryOptions: {
          locale: 'en',
        },
      },
    });
    const swaggerMetadata = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      handler,
    ) as unknown as {
      readonly 201: {
        readonly description: string;
        readonly example: {
          readonly id: number;
          readonly publishedAt: string;
        };
        readonly isArray: boolean;
        readonly standardSchema: StandardJSONSchemaV1;
      };
    };

    expect(swaggerMetadata[201]).toMatchObject({
      description: 'Products created by the request.',
      example: {
        id: 1,
        publishedAt: '2026-07-31T00:00:00.000Z',
      },
      isArray: true,
    });
    expect(
      swaggerMetadata[201].standardSchema['~standard'].jsonSchema.output({
        target: 'openapi-3.0',
      }),
    ).toMatchObject({
      items: {
        type: 'object',
      },
      type: 'array',
    });
  });

  it('supports class-level defaults and a raw Standard Schema', () => {
    @ApiStandardSchemaResponse(ProductResponseSchema, {
      description: 'Product response.',
      examples: {
        product: {
          summary: 'A published product.',
          value: {
            id: 1,
            publishedAt: '2026-07-31T00:00:00.000Z',
          },
        },
      },
      status: 200,
    })
    class TestController {}

    expect(
      Reflect.getMetadata(CLASS_SERIALIZER_OPTIONS, TestController),
    ).toEqual({
      schema: ProductResponseSchema,
    });
    expect(
      Reflect.getMetadata(DECORATORS.API_RESPONSE, TestController),
    ).toMatchObject({
      200: {
        description: 'Product response.',
        examples: {
          product: {
            summary: 'A published product.',
          },
        },
        standardSchema: ProductResponseSchema,
      },
    });
  });

  it('wraps custom converter array results and preserves components', () => {
    class TestController {
      @ApiStandardSchemaResponse(ConverterOnlyProductSchema, {
        isArray: true,
        status: 200,
      })
      list(): void {}
    }

    const handler = TestController.prototype.list;
    expect(Reflect.getMetadata(CLASS_SERIALIZER_OPTIONS, handler)).toEqual({
      schema: ConverterOnlyProductSchema,
    });
    const swaggerMetadata = Reflect.getMetadata(
      DECORATORS.API_RESPONSE,
      handler,
    ) as unknown as {
      readonly 200: {
        readonly standardSchema: StandardSchemaV1;
      };
    };
    const components = {
      Product: {
        properties: {
          id: { type: 'number' },
        },
        type: 'object',
      },
    };
    const converter = vi.fn(() => ({
      components,
      schema: {
        $ref: '#/components/schemas/Product',
      },
    }));
    const wrappedConverter = withStandardSchemaResponseArrays(converter);

    expect(
      wrappedConverter(swaggerMetadata[200].standardSchema, {
        schemaType: 'output',
      }),
    ).toEqual({
      components,
      schema: {
        items: {
          $ref: '#/components/schemas/Product',
        },
        type: 'array',
      },
    });
    expect(converter).toHaveBeenCalledWith(ConverterOnlyProductSchema, {
      schemaType: 'output',
    });
  });

  it('recognizes array metadata created by another installed package copy', () => {
    const converter = vi.fn(() => ({ schema: { type: 'object' } }));
    const wrappedConverter = withStandardSchemaResponseArrays(converter);
    const duplicateCopySchema = {
      [Symbol.for('@nestm/standard-schema:swagger-array-item')]:
        ConverterOnlyProductSchema,
      '~standard': ConverterOnlyProductSchema['~standard'],
    } as StandardSchemaV1;

    expect(
      wrappedConverter(duplicateCopySchema, { schemaType: 'output' }),
    ).toEqual({
      schema: { items: { type: 'object' }, type: 'array' },
    });
    expect(converter).toHaveBeenCalledWith(ConverterOnlyProductSchema, {
      schemaType: 'output',
    });
  });
});
