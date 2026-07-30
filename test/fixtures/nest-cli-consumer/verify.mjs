import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Test } from '@nestjs/testing';
import request from 'supertest';

const require = createRequire(import.meta.url);
const pluginPath = require.resolve('@nestm/standard-schema/plugin');
const plugin = require(pluginPath);

assert.match(pluginPath, /dist[/\\]plugin[/\\]index\.cjs$/);
assert.equal(typeof plugin.before, 'function');

await verifyBuild('dist', true);
await verifyBuild('dist-no-plugin', false);

async function verifyBuild(outputDirectory, pluginEnabled) {
  const outputRoot = resolve(outputDirectory);
  const appModule = await import(
    pathToFileURL(resolve(outputRoot, 'app.module.js')).href
  );
  const controllerModule = await import(
    pathToFileURL(resolve(outputRoot, 'products.controller.js')).href
  );
  const testingModule = await Test.createTestingModule({
    imports: [appModule.AppModule],
  }).compile();
  const app = testingModule.createNestApplication({ logger: false });

  await app.init();

  try {
    const created = await request(app.getHttpServer())
      .post('/products')
      .send({
        name: '  Keyboard  ',
        price: '49.90',
        ignored: 'strip me',
      })
      .expect(201);

    assert.deepEqual(controllerModule.getCapturedBody(), {
      name: 'Keyboard',
      price: 49.9,
      active: true,
    });
    assert.equal(created.body.publishedAt, '2026-07-30T12:00:00.000Z');
    assert.equal(
      Object.hasOwn(created.body, 'internalRevision'),
      !pluginEnabled,
    );

    const one = await request(app.getHttpServer())
      .get('/products/one')
      .expect(200);
    assert.equal(one.body.name, 'Keyboard');
    assert.equal(Object.hasOwn(one.body, 'internalRevision'), !pluginEnabled);

    const list = await request(app.getHttpServer())
      .get('/products/all')
      .expect(200);
    assert.equal(Array.isArray(list.body), true);
    assert.equal(list.body.length, 2);
    assert.equal(
      list.body.some((item) => Object.hasOwn(item, 'internalRevision')),
      !pluginEnabled,
    );

    await request(app.getHttpServer())
      .get('/products/broken')
      .expect(pluginEnabled ? 500 : 200);

    const explicit = await request(app.getHttpServer())
      .get('/products/explicit')
      .expect(200);
    assert.deepEqual(explicit.body, {
      message: 'explicit metadata wins',
    });
  } finally {
    await app.close();
    await testingModule.close();
  }
}
