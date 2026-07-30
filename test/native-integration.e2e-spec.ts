import 'reflect-metadata';

import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';

import {
  createStandardSchemaDto,
  StandardSchemaModule,
  StandardSchemaResponse,
} from '../src/index.js';

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

let capturedBody: unknown;
let capturedQuery: unknown;
let capturedParams: unknown;

@Controller('products')
@StandardSchemaResponse(ProductResponseDto)
class ProductsController {
  @Post()
  create(@Body() input: CreateProductDto): ProductResponseDto {
    capturedBody = input;

    const product = {
      id: 1,
      ...input,
      internalRevision: 1,
    };

    return product;
  }

  @Get()
  findAll(@Query() query: ListProductsQueryDto): ProductResponseDto[] {
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
  broken(): ProductResponseDto {
    return {
      id: -1,
      name: 'Broken',
      price: 1,
      active: true,
    };
  }

  @Get(':id')
  findOne(@Param() params: ProductParamsDto): ProductResponseDto {
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
  let app: INestApplication;

  beforeAll(async () => {
    const testingModule = await Test.createTestingModule({
      imports: [StandardSchemaModule.forRoot()],
      controllers: [ProductsController],
    }).compile();

    app = testingModule.createNestApplication({
      logger: false,
    });
    await app.init();
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
    const response = await request(app.getHttpServer())
      .post('/products')
      .send({
        name: '  Keyboard  ',
        price: '49.90',
        ignored: 'strip me',
      })
      .expect(201);

    expect(capturedBody).toEqual({
      name: 'Keyboard',
      price: 49.9,
      active: true,
    });
    expect(capturedBody).not.toBeInstanceOf(CreateProductDto);
    expect(response.body).toEqual({
      id: 1,
      name: 'Keyboard',
      price: 49.9,
      active: true,
    });
  });

  it('infers query and whole-params object schemas', async () => {
    await request(app.getHttpServer())
      .get('/products')
      .query({ active: 'false' })
      .expect(200);

    expect(capturedQuery).toEqual({ active: false });

    const response = await request(app.getHttpServer())
      .get('/products/7')
      .expect(200);

    expect(capturedParams).toEqual({ id: 7 });
    expect(response.body.id).toBe(7);
  });

  it('keeps Nest native 400 validation envelopes', async () => {
    const invalidBody = await request(app.getHttpServer())
      .post('/products')
      .send({ name: '', price: -1 })
      .expect(400);

    expect(invalidBody.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
    });
    expect(invalidBody.body.message).toEqual(
      expect.arrayContaining([expect.any(String)]),
    );

    await request(app.getHttpServer()).get('/products/nope').expect(400);
  });

  it('uses Nest native item-by-item array serialization', async () => {
    const response = await request(app.getHttpServer())
      .get('/products')
      .expect(200);

    expect(response.body).toEqual([
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
    await request(app.getHttpServer()).get('/products/broken').expect(500);
  });
});
