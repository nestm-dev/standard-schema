import {
  createSchemaClass,
  createResponseSchemaClass,
} from '@nestm/standard-schema';
import { z } from 'zod';

const CreateProductSchema = z.object({
  name: z.string().trim().min(1),
  price: z.coerce.number().nonnegative(),
  active: z.boolean().default(true),
});

export class CreateProduct extends createSchemaClass(CreateProductSchema) {}

const ListProductsQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  active: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export class ListProductsQuery extends createSchemaClass(
  ListProductsQuerySchema,
) {}

const ProductParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export class ProductParams extends createSchemaClass(ProductParamsSchema) {}

const DateToIsoStringSchema = z.codec(z.date(), z.iso.datetime(), {
  decode: (value) => value.toISOString(),
  encode: (value) => new Date(value),
});

const ProductResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  price: z.number().nonnegative(),
  active: z.boolean(),
  createdAt: DateToIsoStringSchema,
  updatedAt: DateToIsoStringSchema,
});

export class ProductResponse extends createResponseSchemaClass(
  ProductResponseSchema,
) {}

const ProductSummaryResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});

export class ProductSummaryResponse extends createResponseSchemaClass(
  ProductSummaryResponseSchema,
) {}
