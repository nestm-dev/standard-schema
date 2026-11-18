import {
  Injectable,
  Optional,
  StandardSchemaValidationPipe,
  type ArgumentMetadata,
  type StandardSchemaValidationPipeOptions,
} from '@nestjs/common';
import type { StandardSchemaV1 } from '@standard-schema/spec';

import { isResponseSchemaClass, isSchemaClass } from './schema.js';
import {
  createValidationProblemFactory,
  type SchemaValidationExceptionFactory,
  type ValidationProblemOptions,
} from './validation-problem.js';

export interface SchemaClassValidationPipeOptions extends Omit<
  StandardSchemaValidationPipeOptions,
  'exceptionFactory'
> {
  /**
   * Builds the exception thrown for invalid input. It receives the schema
   * issues and the metadata of the parameter that failed validation.
   */
  exceptionFactory?: SchemaValidationExceptionFactory;
  /**
   * Responds to invalid input with an RFC 9457 `application/problem+json`
   * validation problem. Cannot be combined with `exceptionFactory`.
   */
  problemDetails?: boolean | ValidationProblemOptions;
}

/** Carries issues out of Nest's pipe to the metadata-aware factory. */
class ValidationIssues {
  constructor(readonly issues: readonly StandardSchemaV1.Issue[]) {}
}

/**
 * Discovers a Standard Schema from a reflected schema class, then delegates
 * parsing and error handling to Nest's native validation pipe.
 */
@Injectable()
export class SchemaClassValidationPipe extends StandardSchemaValidationPipe {
  private readonly issuesExceptionFactory:
    SchemaValidationExceptionFactory | undefined;

  constructor(@Optional() options: SchemaClassValidationPipeOptions = {}) {
    const {
      exceptionFactory,
      problemDetails = false,
      ...nativeOptions
    } = options;

    if (exceptionFactory !== undefined && problemDetails !== false) {
      throw new TypeError(
        'Pass either validation.exceptionFactory or validation.problemDetails, not both.',
      );
    }

    const issuesExceptionFactory =
      problemDetails === false
        ? exceptionFactory
        : createValidationProblemFactory({
            ...(nativeOptions.errorHttpStatusCode === undefined
              ? {}
              : { status: nativeOptions.errorHttpStatusCode }),
            ...(problemDetails === true ? {} : problemDetails),
          });

    super(
      issuesExceptionFactory === undefined
        ? nativeOptions
        : {
            ...nativeOptions,
            exceptionFactory: (issues) => new ValidationIssues(issues),
          },
    );

    this.issuesExceptionFactory = issuesExceptionFactory;
  }

  override async transform<T = unknown>(
    value: T,
    metadata: ArgumentMetadata,
  ): Promise<T> {
    const schema =
      metadata.schema ??
      (isSchemaClass(metadata.metatype) ||
      isResponseSchemaClass(metadata.metatype)
        ? metadata.metatype.schema
        : undefined);
    const resolvedMetadata =
      schema === undefined ? metadata : { ...metadata, schema };

    try {
      return await super.transform(value, resolvedMetadata);
    } catch (error) {
      if (
        error instanceof ValidationIssues &&
        this.issuesExceptionFactory !== undefined
      ) {
        throw this.issuesExceptionFactory(error.issues, resolvedMetadata);
      }

      throw error;
    }
  }
}
