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

const ProductResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  price: z.number().nonnegative(),
  active: z.boolean(),
  publishedAt: z.date().transform((value) => value.toISOString()),
});

export class ProductResponseDto extends createStandardSchemaResponseDto(
  ProductResponseSchema,
) {}

const MessageResponseSchema = z.object({
  message: z.string(),
});

export class MessageResponseDto extends createStandardSchemaResponseDto(
  MessageResponseSchema,
) {}
