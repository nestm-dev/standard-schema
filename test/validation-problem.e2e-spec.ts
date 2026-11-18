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
import { ExpressAdapter } from '@nestjs/platform-express';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { z } from 'zod';

import {
  StandardSchemaModule,
  StandardSchemaResponse,
  type ValidationProblem,
} from '../src/index.js';

const CreateOrderSchema = z.strictObject({
  lines: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
});

const ListOrdersQuerySchema = z.object({
  limit: z.coerce.number().int().max(100).optional(),
});

const OrderParamsSchema = z.object({ id: z.uuid() });

const OrderSchema = z.object({ id: z.string(), lines: z.number() });

@Controller('orders')
class OrdersController {
  @Post()
  @StandardSchemaResponse(OrderSchema)
  create(
    @Body({ schema: CreateOrderSchema })
    input: z.output<typeof CreateOrderSchema>,
  ): unknown {
    return { id: 'new', lines: input.lines.length, internal: true };
  }

  @Get()
  @StandardSchemaResponse(OrderSchema)
  list(
    @Query({ schema: ListOrdersQuerySchema })
    query: z.output<typeof ListOrdersQuerySchema>,
  ): unknown[] {
    return [{ id: 'a', lines: query.limit ?? 0 }];
  }

  @Get(':id')
  @StandardSchemaResponse(OrderSchema)
  findOne(
    @Param({ schema: OrderParamsSchema })
    params: z.output<typeof OrderParamsSchema>,
  ): unknown {
    return { id: params.id, lines: 1 };
  }
}

describe.each([
  ['Express', () => new ExpressAdapter()],
  ['Fastify', () => new FastifyAdapter()],
])('validation.problemDetails with %s', (_name, createAdapter) => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        StandardSchemaModule.forRoot({
          validation: {
            problemDetails: { typeBaseUri: 'https://example.com/problems/' },
          },
          serialization: { requireResponseSchema: true },
        }),
      ],
      controllers: [OrdersController],
    }).compile();

    app = moduleRef.createNestApplication(createAdapter(), { logger: false });
    await app.init();

    const instance = app.getHttpAdapter().getInstance() as {
      ready?: () => Promise<unknown>;
    };

    await instance.ready?.();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers invalid bodies with application/problem+json', async () => {
    const response = await request(app.getHttpServer())
      .post('/orders')
      .send({ lines: [{ sku: '', quantity: 0 }], 'x~/y': true });

    expect(response.status).toBe(400);
    expect(response.headers['content-type']).toMatch(
      /^application\/problem\+json/,
    );
    expect(JSON.parse(response.text) as ValidationProblem).toEqual({
      type: 'https://example.com/problems/validation-failed',
      title: 'Request validation failed',
      status: 400,
      detail: '3 validation errors in the request body.',
      errors: [
        {
          in: 'body',
          pointer: '/lines/0/sku',
          code: 'too_small',
          message: expect.any(String),
        },
        {
          in: 'body',
          pointer: '/lines/0/quantity',
          code: 'too_small',
          message: expect.any(String),
        },
        {
          in: 'body',
          pointer: '/x~0~1y',
          code: 'unrecognized_keys',
          message: 'Unrecognized key: "x~/y"',
        },
      ],
    });
  });

  it('locates query and path parameter errors', async () => {
    const query = await request(app.getHttpServer()).get('/orders?limit=abc');
    const path = await request(app.getHttpServer()).get('/orders/not-a-uuid');

    expect(query.status).toBe(400);
    expect(JSON.parse(query.text)).toMatchObject({
      detail: '1 validation error in the query string.',
      errors: [{ in: 'query', pointer: '/limit', code: 'invalid_type' }],
    });
    expect(path.status).toBe(400);
    expect(path.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(JSON.parse(path.text)).toMatchObject({
      errors: [{ in: 'path', pointer: '/id', code: 'invalid_format' }],
    });
  });

  it('keeps successful responses and other errors unchanged', async () => {
    const created = await request(app.getHttpServer())
      .post('/orders')
      .send({ lines: [{ sku: 'A', quantity: 2 }] });
    const missing = await request(app.getHttpServer()).get('/missing');

    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: 'new', lines: 1 });
    expect(missing.status).toBe(404);
    expect(missing.headers['content-type']).toMatch(/^application\/json/);
  });
});
