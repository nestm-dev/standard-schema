import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule);
const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);
const openApiDocument = SwaggerModule.createDocument(
  app,
  new DocumentBuilder()
    .setTitle('Standard Schema products API')
    .setVersion('1')
    .build(),
);

SwaggerModule.setup('docs', app, openApiDocument);
app.enableShutdownHooks();
await app.listen(port);
