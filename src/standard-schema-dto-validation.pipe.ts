import {
  Injectable,
  StandardSchemaValidationPipe,
  type ArgumentMetadata,
} from '@nestjs/common';

import { isStandardSchemaDto } from './schema.js';

/**
 * Adds DTO-carried schemas to Nest argument metadata, then delegates parsing
 * and error handling to Nest's native `StandardSchemaValidationPipe`.
 */
@Injectable()
export class StandardSchemaDtoValidationPipe extends StandardSchemaValidationPipe {
  override transform<T = unknown>(
    value: T,
    metadata: ArgumentMetadata,
  ): Promise<T> {
    const schema =
      metadata.schema ??
      (isStandardSchemaDto(metadata.metatype)
        ? metadata.metatype.schema
        : undefined);

    return super.transform(value, {
      ...metadata,
      ...(schema === undefined ? {} : { schema }),
    });
  }
}
