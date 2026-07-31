import 'reflect-metadata';

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { z } from 'zod';

import { createStandardSchemaDto, StandardSchemaModule } from '../src/index.js';
import {
  ApiStandardSchemaResponse,
  withStandardSchemaResponseArrays,
} from '../src/swagger/index.js';

const CreateProductSchema = z.object({
  name: z.string().trim().min(1),
  price: z.coerce.number().nonnegative(),
  active: z.boolean().default(true),
});

class CreateProductDto extends createStandardSchemaDto(CreateProductSchema) {}

const ListProductsQuerySchema = z.object({
  active: z.stringbool().optional(),
});

class ListProductsQueryDto extends createStandardSchemaDto(
  ListProductsQuerySchema,
) {}

const ProductParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

class ProductParamsDto extends createStandardSchemaDto(ProductParamsSchema) {}

const ProductResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  price: z.number().nonnegative(),
  active: z.boolean(),
});

class ProductResponseDto extends createStandardSchemaDto(
  ProductResponseSchema,
) {}

interface ConverterOnlyProduct {
  readonly id: number;
  readonly name: string;
}

const ConverterOnlyProductSchema: StandardSchemaV1<
  unknown,
  ConverterOnlyProduct
> = {
  '~standard': {
    validate: (value) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        'id' in value &&
        typeof value.id === 'number' &&
        'name' in value &&
        typeof value.name === 'string'
      ) {
        return {
          value: {
            id: value.id,
            name: value.name,
          },
        };
      }

      return {
        issues: [{ message: 'Expected a converter-only product.' }],
      };
    },
    vendor: 'converter-only',
    version: 1,
  },
};

let capturedBody: unknown;
let capturedQuery: unknown;
let capturedParams: unknown;
const converterOnlySchemaTypes: Array<'input' | 'output'> = [];

@Controller('products')
class ProductsController {
  @Post()
  @ApiStandardSchemaResponse(ProductResponseDto, {
    description: 'Product created.',
    status: 201,
  })
  create(
    @Body({ schema: CreateProductDto.schema }) input: CreateProductDto,
  ): ProductResponseDto {
    capturedBody = input;

    const product = {
      id: 1,
      ...input,
      internalRevision: 1,
    };

    return product;
  }

  @Get()
  @ApiStandardSchemaResponse(ProductResponseDto, {
    description: 'Products returned.',
    isArray: true,
    status: 200,
  })
  findAll(
    @Query({ schema: ListProductsQueryDto.schema })
    query: ListProductsQueryDto,
  ): ProductResponseDto[] {
    capturedQuery = query;

    const products = [
      {
        id: 1,
        name: 'Keyboard',
        price: 49.9,
        active: query.active ?? true,
        internalRevision: 2,
      },
      {
        id: 2,
        name: 'Mouse',
        price: 19.9,
        active: query.active ?? true,
        internalRevision: 3,
      },
    ];

    return products;
  }

  @Get('broken')
  @ApiStandardSchemaResponse(ProductResponseDto, { status: 200 })
  broken(): ProductResponseDto {
    return {
      id: -1,
      name: 'Broken',
      price: 1,
      active: true,
    };
  }

  @Get('converter-only')
  @ApiStandardSchemaResponse(ConverterOnlyProductSchema, {
    description: 'Converter-only products returned.',
    isArray: true,
    status: 200,
  })
  converterOnly(): ConverterOnlyProduct[] {
    return [{ id: 1, name: 'Keyboard' }];
  }

  @Get(':id')
  @ApiStandardSchemaResponse(ProductResponseDto, { status: 200 })
  findOne(
    @Param({ schema: ProductParamsDto.schema }) params: ProductParamsDto,
  ): ProductResponseDto {
    capturedParams = params;

    return {
      id: params.id,
      name: 'Keyboard',
      price: 49.9,
      active: true,
    };
  }
}

describe('Nest native Standard Schema integration', () => {
  let app: NestFastifyApplication;
  let openApiDocument: OpenAPIObject;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [StandardSchemaModule.forRoot()],
      controllers: [ProductsController],
    }).compile();

    app = testingModule.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      {
        logger: false,
      },
    );
    await app.init();
    openApiDocument = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Standard Schema test API')
        .setVersion('1')
        .build(),
      {
        standardSchemaConverter: withStandardSchemaResponseArrays(
          (schema, options) => {
            if (schema !== ConverterOnlyProductSchema) {
              return undefined;
            }

            converterOnlySchemaTypes.push(options.schemaType);

            return {
              components: {
                ConverterOnlyProduct: {
                  properties: {
                    id: { type: 'number' },
                    name: { type: 'string' },
                  },
                  required: ['id', 'name'],
                  type: 'object',
                },
              },
              schema: {
                $ref: '#/components/schemas/ConverterOnlyProduct',
              },
            };
          },
        ),
      },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    capturedBody = undefined;
    capturedQuery = undefined;
    capturedParams = undefined;
  });

  it('infers a body schema from @Body() DTO metadata and returns parsed values', async () => {
    const response = await app.inject({
      method: 'POST',
      payload: {
        name: '  Keyboard  ',
        price: '49.90',
        ignored: 'strip me',
      },
      url: '/products',
    });

    expect(response.statusCode).toBe(201);
    expect(capturedBody).toEqual({
      name: 'Keyboard',
      price: 49.9,
      active: true,
    });
    expect(capturedBody).not.toBeInstanceOf(CreateProductDto);
    expect(response.json()).toEqual({
      id: 1,
      name: 'Keyboard',
      price: 49.9,
      active: true,
    });
  });

  it('infers query and whole-params object schemas', async () => {
    const listResponse = await app.inject({
      method: 'GET',
      url: '/products?active=false',
    });

    expect(listResponse.statusCode).toBe(200);
    expect(capturedQuery).toEqual({ active: false });

    const response = await app.inject({
      method: 'GET',
      url: '/products/7',
    });

    expect(response.statusCode).toBe(200);
    expect(capturedParams).toEqual({ id: 7 });
    expect(response.json().id).toBe(7);
  });

  it('keeps Nest native 400 validation envelopes', async () => {
    const invalidBody = await app.inject({
      method: 'POST',
      payload: { name: '', price: -1 },
      url: '/products',
    });

    expect(invalidBody.statusCode).toBe(400);
    expect(invalidBody.json()).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
    });
    expect(invalidBody.json().message).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );

    const invalidParams = await app.inject({
      method: 'GET',
      url: '/products/nope',
    });

    expect(invalidParams.statusCode).toBe(400);
  });

  it('uses Nest native item-by-item array serialization', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/products',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      {
        id: 1,
        name: 'Keyboard',
        price: 49.9,
        active: true,
      },
      {
        id: 2,
        name: 'Mouse',
        price: 19.9,
        active: true,
      },
    ]);
  });

  it('treats invalid service output as a native 500 contract failure', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/products/broken',
    });

    expect(response.statusCode).toBe(500);
  });

  it('publishes request and response Standard Schemas through Swagger', () => {
    expect(openApiDocument.paths['/products']?.post).toMatchObject({
      requestBody: {
        content: {
          'application/json': {
            schema: {
              properties: {
                active: { default: true, type: 'boolean' },
                name: { minLength: 1, type: 'string' },
                price: { minimum: 0, type: 'number' },
              },
              required: ['name', 'price'],
              type: 'object',
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Product created.',
          content: {
            'application/json': {
              schema: {
                properties: {
                  active: { type: 'boolean' },
                  id: { minimum: 0, type: 'integer' },
                  name: { type: 'string' },
                  price: { minimum: 0, type: 'number' },
                },
                required: ['id', 'name', 'price', 'active'],
                type: 'object',
              },
            },
          },
        },
      },
    });
    expect(
      openApiDocument.paths['/products']?.get?.responses?.['200'],
    ).toMatchObject({
      description: 'Products returned.',
      content: {
        'application/json': {
          schema: {
            items: {
              type: 'object',
            },
            type: 'array',
          },
        },
      },
    });
    expect(
      openApiDocument.paths['/products/converter-only']?.get?.responses?.[
        '200'
      ],
    ).toMatchObject({
      description: 'Converter-only products returned.',
      content: {
        'application/json': {
          schema: {
            items: {
              $ref: '#/components/schemas/ConverterOnlyProduct',
            },
            type: 'array',
          },
        },
      },
    });
    expect(
      openApiDocument.components?.schemas?.['ConverterOnlyProduct'],
    ).toMatchObject({
      properties: {
        id: { type: 'number' },
        name: { type: 'string' },
      },
      required: ['id', 'name'],
      type: 'object',
    });
    expect(converterOnlySchemaTypes).toContain('output');
  });
});
