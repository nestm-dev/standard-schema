import {
  Injectable,
  StandardSchemaValidationPipe,
  type ArgumentMetadata,
} from '@nestjs/common';

import { isResponseSchemaClass, isSchemaClass } from './schema.js';

/**
 * Discovers a Standard Schema from a reflected schema class, then delegates
 * parsing and error handling to Nest's native validation pipe.
 */
@Injectable()
export class SchemaClassValidationPipe extends StandardSchemaValidationPipe {
  override transform<T = unknown>(
    value: T,
    metadata: ArgumentMetadata,
  ): Promise<T> {
    const schema =
      metadata.schema ??
      (isSchemaClass(metadata.metatype) ||
      isResponseSchemaClass(metadata.metatype)
        ? metadata.metatype.schema
        : undefined);

    return super.transform(value, {
      ...metadata,
      ...(schema === undefined ? {} : { schema }),
    });
  }
}
