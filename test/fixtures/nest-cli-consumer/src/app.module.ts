import { Module } from '@nestjs/common';
import { StandardSchemaModule } from '@nestm/standard-schema';

import { ProductsController } from './products.controller.js';

@Module({
  imports: [StandardSchemaModule.forRoot()],
  controllers: [ProductsController],
})
export class AppModule {}
