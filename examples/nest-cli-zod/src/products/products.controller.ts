import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { StandardSchemaResponse } from '@nestm/standard-schema';

import {
  CreateProductDto,
  ListProductsQueryDto,
  ProductParamsDto,
  type ProductResponseDto,
  ProductSummaryResponseDto,
} from './product.dto.js';
import { ProductsService } from './products.service.js';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  create(@Body() input: CreateProductDto): ProductResponseDto {
    return this.productsService.create(input);
  }

  @Get()
  async findAll(
    @Query() query: ListProductsQueryDto,
  ): Promise<ProductResponseDto[]> {
    return this.productsService.findAll(query);
  }

  @Get('summary')
  @StandardSchemaResponse(ProductSummaryResponseDto)
  getSummary(): ProductSummaryResponseDto | ProductResponseDto {
    return this.productsService.getSummary();
  }

  @Get(':id')
  async findOne(
    @Param() params: ProductParamsDto,
  ): Promise<ProductResponseDto> {
    return this.productsService.findOne(params.id);
  }
}
