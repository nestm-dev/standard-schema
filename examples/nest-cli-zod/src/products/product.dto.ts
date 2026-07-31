import {
  createStandardSchemaDto,
  createStandardSchemaResponseDto,
} from '@nestm/standard-schema';
import { z } from 'zod';

const CreateProductSchema = z.object({
  name: z.string().trim().min(1),
  price: z.coerce.number().nonnegative(),
  active: z.boolean().default(true),
});

export class CreateProductDto extends createStandardSchemaDto(
  CreateProductSchema,
) {}

const ListProductsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  active: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export class ListProductsQueryDto extends createStandardSchemaDto(
  ListProductsQuerySchema,
) {}

const ProductParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export class ProductParamsDto extends createStandardSchemaDto(
  ProductParamsSchema,
) {}

const ProductResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  price: z.number().nonnegative(),
  active: z.boolean(),
  createdAt: z.date().transform((value) => value.toISOString()),
  updatedAt: z.date().transform((value) => value.toISOString()),
});

export class ProductResponseDto extends createStandardSchemaResponseDto(
  ProductResponseSchema,
) {}

const ProductSummaryResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});

export class ProductSummaryResponseDto extends createStandardSchemaResponseDto(
  ProductSummaryResponseSchema,
) {}
