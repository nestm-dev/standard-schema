import 'reflect-metadata';

import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Res,
  StreamableFile,
  type INestApplication,
  type Type,
} from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { z } from 'zod';

import {
  MissingResponseSchemaError,
  SkipResponseSchema,
  StandardSchemaModule,
  StandardSchemaResponse,
} from '../src/index.js';
import { ResponseSchemaSerializerInterceptor } from '../src/response-schema-serializer.interceptor.js';

const ItemSchema = z.object({ id: z.number() });

async function createApp(
  imports: Parameters<typeof Test.createTestingModule>[0]['imports'],
  controllers: Type<unknown>[],
  providers: Parameters<typeof Test.createTestingModule>[0]['providers'] = [],
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: imports ?? [],
    controllers,
    providers: providers ?? [],
  }).compile();

  return moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
}

describe('serialization.requireResponseSchema', () => {
  describe('at bootstrap', () => {
    @Controller('mixed')
    class MixedController {
      @Get()
      @StandardSchemaResponse(ItemSchema)
      withSchema(): unknown {
        return { id: 1 };
      }

      @Get('missing')
      missing(): unknown {
        return { id: 1 };
      }

      @Delete(':id')
      @HttpCode(204)
      remove(): void {}

      @Get('skipped')
      @SkipResponseSchema()
      skipped(): unknown {
        return {};
      }
    }

    @Controller('other')
    class OtherController {
      @Get()
      list(): unknown[] {
        return [];
      }
    }

    let app: INestApplication | undefined;

    afterEach(async () => {
      await app?.close();
      app = undefined;
    });

    it('fails with every JSON route that has no response schema', async () => {
      app = await createApp(
        [
          StandardSchemaModule.forRoot({
            serialization: { requireResponseSchema: true },
          }),
        ],
        [MixedController, OtherController],
      );

      const error: unknown = await app
        .init()
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(MissingResponseSchemaError);
      expect((error as MissingResponseSchemaError).routes).toEqual([
        {
          controller: 'MixedController',
          handler: 'missing',
          method: 'GET',
          paths: ['/mixed/missing'],
        },
        {
          controller: 'OtherController',
          handler: 'list',
          method: 'GET',
          paths: ['/other'],
        },
      ]);
    });

    it('stays backwards compatible by default', async () => {
      app = await createApp(
        [StandardSchemaModule.forRoot()],
        [MixedController, OtherController],
      );

      await expect(app.init()).resolves.toBe(app);
    });

    it('honors a module-wide default schema', async () => {
      app = await createApp(
        [
          StandardSchemaModule.forRoot({
            serialization: {
              requireResponseSchema: true,
              schema: z.unknown(),
            },
          }),
        ],
        [MixedController, OtherController],
      );

      await expect(app.init()).resolves.toBe(app);
    });
  });

  describe('at request time', () => {
    interface ReplyLike {
      send(body: unknown): void;
    }

    @Controller('runtime')
    class RuntimeController {
      @Get('leak')
      leak(): unknown {
        return { secret: 'hunter2' };
      }

      @Get('primitive')
      primitive(): unknown {
        return 42;
      }

      @Get('empty')
      empty(): void {}

      @Get('null')
      nothing(): null {
        return null;
      }

      @Get('schema')
      @StandardSchemaResponse(ItemSchema)
      withSchema(): unknown {
        return { id: 1, secret: 'hunter2' };
      }

      @Get('skipped')
      @SkipResponseSchema()
      skipped(): unknown {
        return { raw: true };
      }

      @Get('file')
      file(): unknown {
        return new StreamableFile(Buffer.from('file'));
      }

      @Get('text')
      @Header('Content-Type', 'text/plain')
      text(): string {
        return 'ok';
      }

      @Get('response')
      response(@Res() reply: ReplyLike): void {
        reply.send({ raw: true });
      }
    }

    let app: NestFastifyApplication;

    beforeAll(async () => {
      // Without the bootstrap check, every route reaches the runtime guard.
      app = await createApp(
        [],
        [RuntimeController],
        [
          {
            provide: APP_INTERCEPTOR,
            inject: [Reflector],
            useFactory: (reflector: Reflector) =>
              new ResponseSchemaSerializerInterceptor(reflector),
          },
        ],
      );
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it.each(['leak', 'primitive'])(
      'rejects a %s body without a schema with an opaque 500',
      async (route) => {
        const response = await app.inject({ url: `/runtime/${route}` });

        expect(response.statusCode).toBe(500);
        expect(response.json()).toEqual({
          statusCode: 500,
          message: 'Internal server error',
        });
        expect(response.body).not.toContain('hunter2');
      },
    );

    it('serializes routes that have a schema as before', async () => {
      const response = await app.inject({ url: '/runtime/schema' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ id: 1 });
    });

    it('lets an empty or null body through', async () => {
      const empty = await app.inject({ url: '/runtime/empty' });
      const nothing = await app.inject({ url: '/runtime/null' });

      expect(empty.statusCode).toBe(200);
      expect(empty.body).toBe('');
      expect(nothing.statusCode).toBe(200);
      expect(['', 'null']).toContain(nothing.body);
    });

    it.each([
      ['skipped', '{"raw":true}'],
      ['file', 'file'],
      ['text', 'ok'],
      ['response', '{"raw":true}'],
    ])('lets the %s route through', async (route, body) => {
      const response = await app.inject({ url: `/runtime/${route}` });

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(body);
    });
  });
});
