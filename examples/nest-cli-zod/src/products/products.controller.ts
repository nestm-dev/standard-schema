import {
  Body as Payload,
  Controller as ApiController,
  Get as Read,
  Param as RouteParams,
  Post as Create,
  Query as Search,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import { ApiStandardSchemaResponse } from '@nestm/standard-schema/swagger';

import {
  CreateProduct,
  ListProductsQuery,
  ProductParams,
  type ProductResponse,
  ProductSummaryResponse,
} from './product.schemas.js';
import { ProductsService } from './products.service.js';

@ApiController('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Create()
  @ApiCreatedResponse({ description: 'Product created.' })
  create(@Payload() input: CreateProduct): ProductResponse {
    return this.productsService.create(input);
  }

  @Read()
  @ApiOkResponse({ description: 'Products returned.' })
  async findAll(
    @Search() query: ListProductsQuery,
  ): Promise<ProductResponse[]> {
    return this.productsService.findAll(query);
  }

  @Read('summary')
  @ApiStandardSchemaResponse(ProductSummaryResponse, {
    description: 'Product summary returned.',
    status: 200,
  })
  getSummary(): ProductSummaryResponse | ProductResponse {
    return this.productsService.getSummary();
  }

  @Read(':id')
  @ApiOkResponse({ description: 'Product returned.' })
  async findOne(
    @RouteParams() params: ProductParams,
  ): Promise<ProductResponse> {
    return this.productsService.findOne(params.id);
  }
}
