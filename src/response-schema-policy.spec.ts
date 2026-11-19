import {
  Controller,
  Delete,
  Get,
  Head,
  Header,
  HttpCode,
  Post,
  Redirect,
  Render,
  Res,
  SerializeOptions,
  Sse,
  StreamableFile,
} from '@nestjs/common';
import * as internal from '@nestjs/common/internal';
import { z } from 'zod';

import * as metadata from './nest-metadata.js';
import {
  findRoutesWithoutResponseSchema,
  MissingResponseSchemaError,
  writesResponseDirectly,
} from './response-schema-policy.js';
import { SkipResponseSchema } from './skip-response-schema.decorator.js';
import { StandardSchemaResponse } from './standard-schema-response.decorator.js';

const ItemSchema = z.object({ id: z.number() });

function routeKeys(
  routes: ReturnType<typeof findRoutesWithoutResponseSchema>,
): string[] {
  return routes.map(
    (route) =>
      `${route.method} ${route.paths.join(',')} ${route.controller}.${route.handler}`,
  );
}

describe('nest metadata keys', () => {
  it('match the keys Nest writes', () => {
    expect(metadata.PATH_METADATA).toBe(internal.PATH_METADATA);
    expect(metadata.METHOD_METADATA).toBe(internal.METHOD_METADATA);
    expect(metadata.ROUTE_ARGS_METADATA).toBe(internal.ROUTE_ARGS_METADATA);
    expect(metadata.HTTP_CODE_METADATA).toBe(internal.HTTP_CODE_METADATA);
    expect(metadata.HEADERS_METADATA).toBe(internal.HEADERS_METADATA);
    expect(metadata.REDIRECT_METADATA).toBe(internal.REDIRECT_METADATA);
    expect(metadata.RENDER_METADATA).toBe(internal.RENDER_METADATA);
    expect(metadata.RESPONSE_PASSTHROUGH_METADATA).toBe(
      internal.RESPONSE_PASSTHROUGH_METADATA,
    );
    expect(metadata.SSE_METADATA).toBe(internal.SSE_METADATA);
    expect(metadata.RESPONSE_ROUTE_PARAMTYPE).toBe(
      internal.RouteParamtypes.RESPONSE,
    );
    expect(metadata.NEXT_ROUTE_PARAMTYPE).toBe(internal.RouteParamtypes.NEXT);
  });

  it('match the serializer options key', () => {
    class Target {
      @SerializeOptions({ schema: ItemSchema })
      handler(): void {}
    }

    expect(
      Reflect.getMetadata(
        metadata.CLASS_SERIALIZER_OPTIONS,
        Target.prototype.handler,
      ),
    ).toEqual({ schema: ItemSchema });
  });
});

describe(findRoutesWithoutResponseSchema.name, () => {
  it('lists JSON routes without a response schema', () => {
    @Controller('items')
    class ItemsController {
      @Get()
      findAll(): unknown[] {
        return [];
      }

      @Get(':id')
      @StandardSchemaResponse(ItemSchema)
      findOne(): unknown {
        return {};
      }

      @Post(['', 'bulk'])
      create(): unknown {
        return {};
      }

      helper(): void {}
    }

    expect(
      routeKeys(findRoutesWithoutResponseSchema([ItemsController])),
    ).toEqual([
      'GET /items ItemsController.findAll',
      'POST /items,/items/bulk ItemsController.create',
    ]);
  });

  it('accepts controller-level and module-wide schemas', () => {
    @Controller()
    @StandardSchemaResponse(ItemSchema)
    class WithClassSchema {
      @Get()
      findAll(): unknown[] {
        return [];
      }
    }

    @Controller()
    class WithoutSchema {
      @Get('/nested/')
      findAll(): unknown[] {
        return [];
      }
    }

    expect(findRoutesWithoutResponseSchema([WithClassSchema])).toEqual([]);
    expect(
      findRoutesWithoutResponseSchema([WithoutSchema], ItemSchema),
    ).toEqual([]);
    expect(findRoutesWithoutResponseSchema([WithoutSchema])).toEqual([
      {
        controller: 'WithoutSchema',
        handler: 'findAll',
        method: 'GET',
        paths: ['/nested'],
      },
    ]);
  });

  it('exempts responses without a JSON body', () => {
    @Controller('exempt')
    class ExemptController {
      @Delete(':id')
      @HttpCode(204)
      remove(): void {}

      @Get('old')
      @Redirect('/new', 301)
      redirect(): void {}

      @Get('page')
      @Render('page')
      page(): unknown {
        return {};
      }

      @Sse('events')
      events(): unknown {
        return undefined;
      }

      @Get('text')
      @Header('Content-Type', 'text/plain; charset=utf-8')
      text(): string {
        return 'ok';
      }

      @Head()
      head(): void {}

      @Get('file')
      file(): StreamableFile {
        return new StreamableFile(Buffer.from('file'));
      }

      @Get('skipped')
      @SkipResponseSchema()
      skipped(): unknown {
        return {};
      }
    }

    expect(findRoutesWithoutResponseSchema([ExemptController])).toEqual([]);
  });

  it('still requires a schema for JSON Content-Type headers and async files', () => {
    @Controller()
    class JsonController {
      @Get('json')
      @Header('Content-Type', 'application/vnd.api+json')
      json(): unknown {
        return {};
      }

      @Get('file')
      async file(): Promise<StreamableFile> {
        return new StreamableFile(Buffer.from('file'));
      }
    }

    expect(
      routeKeys(findRoutesWithoutResponseSchema([JsonController])),
    ).toEqual([
      'GET /json JsonController.json',
      'GET /file JsonController.file',
    ]);
  });

  it('exempts every route of a skipped controller', () => {
    @Controller('health')
    @SkipResponseSchema()
    class HealthController {
      @Get()
      check(): unknown {
        return { status: 'ok' };
      }
    }

    expect(findRoutesWithoutResponseSchema([HealthController])).toEqual([]);
  });

  it('reports routes that write the response through @Res()', () => {
    @Controller('downloads')
    class DownloadsController {
      @Get()
      download(@Res() response: { send(body: string): void }): void {
        response.send('data');
      }

      @Get('passthrough')
      passthrough(@Res({ passthrough: true }) _response: unknown): unknown {
        return {};
      }
    }

    expect(
      routeKeys(findRoutesWithoutResponseSchema([DownloadsController])),
    ).toEqual([
      'GET /downloads DownloadsController.download',
      'GET /downloads/passthrough DownloadsController.passthrough',
    ]);
    expect(writesResponseDirectly(DownloadsController, 'download')).toBe(true);
    expect(writesResponseDirectly(DownloadsController, 'passthrough')).toBe(
      false,
    );
  });

  it('includes inherited routes once and deduplicates controllers', () => {
    class BaseController {
      @Get()
      findAll(): unknown[] {
        return [];
      }

      @Get('overridden')
      overridden(): unknown {
        return {};
      }
    }

    @Controller('child')
    class ChildController extends BaseController {
      @Get('overridden')
      @StandardSchemaResponse(ItemSchema)
      override overridden(): unknown {
        return {};
      }
    }

    expect(
      routeKeys(
        findRoutesWithoutResponseSchema([ChildController, ChildController]),
      ),
    ).toEqual(['GET /child ChildController.findAll']);
  });
});

describe(MissingResponseSchemaError.name, () => {
  it('lists the routes and how to fix them', () => {
    const error = new MissingResponseSchemaError([
      {
        controller: 'ItemsController',
        handler: 'findAll',
        method: 'GET',
        paths: ['/items'],
      },
    ]);

    expect(error.name).toBe('MissingResponseSchemaError');
    expect(error.routes).toHaveLength(1);
    expect(error.message).toContain('1 route has no response schema');
    expect(error.message).toContain('GET /items (ItemsController.findAll)');
    expect(error.message).toContain('@SkipResponseSchema()');
  });
});
