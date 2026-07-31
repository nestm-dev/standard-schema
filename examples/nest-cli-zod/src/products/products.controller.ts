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
  CreateProductDto,
  ListProductsQueryDto,
  ProductParamsDto,
  type ProductResponseDto,
  ProductSummaryResponseDto,
} from './product.dto.js';
import { ProductsService } from './products.service.js';

@ApiController('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Create()
  @ApiCreatedResponse({ description: 'Product created.' })
  create(@Payload() input: CreateProductDto): ProductResponseDto {
    return this.productsService.create(input);
  }

  @Read()
  @ApiOkResponse({ description: 'Products returned.' })
  async findAll(
    @Search() query: ListProductsQueryDto,
  ): Promise<ProductResponseDto[]> {
    return this.productsService.findAll(query);
  }

  @Read('summary')
  @ApiStandardSchemaResponse(ProductSummaryResponseDto, {
    description: 'Product summary returned.',
    status: 200,
  })
  getSummary(): ProductSummaryResponseDto | ProductResponseDto {
    return this.productsService.getSummary();
  }

  @Read(':id')
  @ApiOkResponse({ description: 'Product returned.' })
  async findOne(
    @RouteParams() params: ProductParamsDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.findOne(params.id);
  }
}
