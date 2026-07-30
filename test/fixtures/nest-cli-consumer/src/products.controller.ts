import { Body, Controller, Get, Post } from '@nestjs/common';
import { StandardSchemaResponse } from '@nestm/standard-schema';

import { CreateProductDto, MessageResponseDto } from './product.dto.js';
import type { ProductResponseDto } from './product.dto.js';

let capturedBody: unknown;

export function getCapturedBody(): unknown {
  return capturedBody;
}

@Controller('products')
export class ProductsController {
  @Post()
  create(@Body() input: CreateProductDto): ProductResponseDto {
    capturedBody = input;

    const product = {
      id: 1,
      ...input,
      publishedAt: new Date('2026-07-30T12:00:00.000Z'),
      internalRevision: 1,
    };

    return product;
  }

  @Get('one')
  async findOne(): Promise<ProductResponseDto> {
    const product = {
      id: 1,
      name: 'Keyboard',
      price: 49.9,
      active: true,
      publishedAt: new Date('2026-07-30T12:00:00.000Z'),
      internalRevision: 2,
    };

    return product;
  }

  @Get('all')
  async findAll(): Promise<ProductResponseDto[]> {
    const products = [
      {
        id: 1,
        name: 'Keyboard',
        price: 49.9,
        active: true,
        publishedAt: new Date('2026-07-30T12:00:00.000Z'),
        internalRevision: 3,
      },
      {
        id: 2,
        name: 'Mouse',
        price: 19.9,
        active: false,
        publishedAt: new Date('2026-07-30T13:00:00.000Z'),
        internalRevision: 4,
      },
    ];

    return products;
  }

  @Get('broken')
  broken(): ProductResponseDto {
    return {
      id: -1,
      name: 'Broken',
      price: 1,
      active: true,
      publishedAt: new Date(),
    };
  }

  @Get('explicit')
  @StandardSchemaResponse(MessageResponseDto)
  explicit(): ProductResponseDto {
    return {
      message: 'explicit metadata wins',
      internalRevision: 5,
    } as unknown as ProductResponseDto;
  }
}
