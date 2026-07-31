import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule);
const port = Number.parseInt(process.env['PORT'] ?? '3000', 10);

app.enableShutdownHooks();
await app.listen(port);
