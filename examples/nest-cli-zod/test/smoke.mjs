import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';

const outputDirectory = process.env['EXAMPLE_OUTPUT_DIRECTORY'] ?? 'dist';
const pluginEnabled = process.env['EXAMPLE_PLUGIN_ENABLED'] !== 'false';
const outputRoot = resolve(outputDirectory);
const require = createRequire(import.meta.url);
const pluginPath = require.resolve('@nestm/standard-schema/plugin');
const plugin = require(pluginPath);
const { AppModule } = await importModule('app.module.js');
const { ProductsService } = await importModule('products/products.service.js');
const { app, testingModule } = await createTestingApp();

assert.match(pluginPath, /dist[/\\]plugin[/\\]index\.cjs$/);
assert.equal(typeof plugin.before, 'function');

try {
  await verifyApplication(app);

  if (pluginEnabled) {
    verifyOpenApiDocument(app);
  }
} finally {
  await app.close();
  await testingModule.close();
}

const malformedProductsService = {
  findOne() {
    return {
      id: -1,
      name: 'Broken contract',
      price: 1,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      internalRevision: 999,
    };
  },
};
const malformedApplication = await createTestingApp(malformedProductsService);

try {
  await request(malformedApplication.app.getHttpServer())
    .get('/products/1')
    .expect(pluginEnabled ? 500 : 200);
} finally {
  await malformedApplication.app.close();
  await malformedApplication.testingModule.close();
}

async function verifyApplication(application) {
  await request(application.getHttpServer())
    .post('/products')
    .send({ name: '', price: -1 })
    .expect(400);

  const created = await request(application.getHttpServer())
    .post('/products')
    .send({
      name: '  Keyboard  ',
      price: '49.90',
      ignored: 'strip me',
    })
    .expect(201);

  assert.equal(created.body.name, 'Keyboard');
  assert.equal(created.body.price, 49.9);
  assert.equal(created.body.active, true);
  assert.equal(typeof created.body.createdAt, 'string');
  assert.equal(Object.hasOwn(created.body, 'ignored'), false);
  assert.equal(Object.hasOwn(created.body, 'internalRevision'), !pluginEnabled);

  const second = await request(application.getHttpServer())
    .post('/products')
    .send({
      name: 'Mouse',
      price: 19.9,
      active: false,
    })
    .expect(201);

  const list = await request(application.getHttpServer())
    .get('/products')
    .query({
      active: 'false',
      limit: '1',
      offset: '0',
    })
    .expect(200);

  assert.equal(Array.isArray(list.body), true);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].id, second.body.id);
  assert.equal(list.body[0].active, false);
  assert.equal(Object.hasOwn(list.body[0], 'internalRevision'), !pluginEnabled);

  const summary = await request(application.getHttpServer())
    .get('/products/summary')
    .expect(200);

  assert.deepEqual(summary.body, { count: 2 });

  const found = await request(application.getHttpServer())
    .get(`/products/${created.body.id}`)
    .expect(200);

  assert.equal(found.body.id, created.body.id);
  assert.equal(found.body.name, 'Keyboard');
  assert.equal(Object.hasOwn(found.body, 'internalRevision'), !pluginEnabled);

  await request(application.getHttpServer())
    .get('/products')
    .query({ limit: '0' })
    .expect(400);
  await request(application.getHttpServer())
    .get('/products/not-a-number')
    .expect(400);
  await request(application.getHttpServer()).get('/products/999').expect(404);
}

function verifyOpenApiDocument(application) {
  const document = SwaggerModule.createDocument(
    application,
    new DocumentBuilder()
      .setTitle('Packed Standard Schema consumer')
      .setVersion('1')
      .build(),
  );
  const createOperation = document.paths['/products']?.post;
  const listOperation = document.paths['/products']?.get;
  const createRequestSchema =
    createOperation?.requestBody?.content?.['application/json']?.schema;
  const createResponse = createOperation?.responses?.['201'];
  const createResponseSchema =
    createResponse?.content?.['application/json']?.schema;
  const listResponseSchema =
    listOperation?.responses?.['200']?.content?.['application/json']?.schema;

  assert.equal(createRequestSchema?.type, 'object');
  assert.equal(createRequestSchema?.properties?.price?.type, 'number');
  assert.equal(createResponse?.description, 'Product created.');
  assert.equal(createResponseSchema?.type, 'object');
  assert.equal(
    createResponseSchema?.properties?.createdAt?.format,
    'date-time',
  );
  assert.equal(
    listOperation?.responses?.['200']?.description,
    'Products returned.',
  );
  assert.equal(listResponseSchema?.type, 'array');
  assert.equal(listResponseSchema?.items?.type, 'object');
}

async function createTestingApp(productsService) {
  const builder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (productsService !== undefined) {
    builder.overrideProvider(ProductsService).useValue(productsService);
  }

  const testingModule = await builder.compile();
  const app = testingModule.createNestApplication({ logger: false });

  await app.init();

  return {
    app,
    testingModule,
  };
}

async function importModule(relativePath) {
  return import(pathToFileURL(resolve(outputRoot, relativePath)).href);
}
