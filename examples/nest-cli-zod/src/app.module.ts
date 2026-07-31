import { Module } from '@nestjs/common';
import { StandardSchemaModule } from '@nestm/standard-schema';

import { ProductsModule } from './products/products.module.js';

@Module({
  imports: [StandardSchemaModule.forRoot(), ProductsModule],
})
export class AppModule {}
