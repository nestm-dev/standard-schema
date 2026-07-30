import { z } from 'zod';

import { createStandardSchemaDto } from './create-standard-schema-dto.js';
import { StandardSchemaResponse } from './standard-schema-response.decorator.js';

const CLASS_SERIALIZER_OPTIONS = 'class_serializer:options';

const ProductResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
});

class ProductResponseDto extends createStandardSchemaDto(
  ProductResponseSchema,
) {}

describe(StandardSchemaResponse.name, () => {
  it('writes the DTO schema into Nest native serializer metadata', () => {
    class TestController {
      @StandardSchemaResponse(ProductResponseDto)
      findOne(): void {}
    }

    const metadata = Reflect.getMetadata(
      CLASS_SERIALIZER_OPTIONS,
      TestController.prototype.findOne,
    );

    expect(metadata).toEqual({
      schema: ProductResponseSchema,
    });
  });

  it('supports class-level defaults and direct schemas', () => {
    @StandardSchemaResponse(ProductResponseSchema, {
      validateOptions: {
        libraryOptions: {
          locale: 'en',
        },
      },
    })
    class TestController {}

    const metadata = Reflect.getMetadata(
      CLASS_SERIALIZER_OPTIONS,
      TestController,
    );

    expect(metadata).toEqual({
      schema: ProductResponseSchema,
      validateOptions: {
        libraryOptions: {
          locale: 'en',
        },
      },
    });
  });
});
