import {
  Catch,
  Inject,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

import {
  PROBLEM_JSON_MEDIA_TYPE,
  ValidationProblemException,
} from './validation-problem.js';

/**
 * Sends a `ValidationProblemException` as an `application/problem+json`
 * HTTP response. Other exceptions keep their usual handling.
 *
 * `validation.problemDetails` registers it globally. An application-wide
 * catch-all exception filter may take precedence; such a filter can send
 * `exception.getResponse()` itself.
 */
@Catch(ValidationProblemException)
export class ValidationProblemFilter implements ExceptionFilter<ValidationProblemException> {
  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
  ) {}

  catch(exception: ValidationProblemException, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      throw exception;
    }

    const { httpAdapter } = this.adapterHost;
    const response: unknown = host.switchToHttp().getResponse();

    httpAdapter.setHeader(response, 'Content-Type', PROBLEM_JSON_MEDIA_TYPE);
    httpAdapter.reply(response, exception.getResponse(), exception.getStatus());
  }
}
