import { ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainException } from '../common/error-code';
import { PROGRAM_ERROR_CODES } from './program-error-code';

@Catch()
export class ProgramDetailExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const errorCode =
      exception instanceof DomainException
        ? exception.errorCode
        : PROGRAM_ERROR_CODES.DETAIL_LOAD_FAILED;
    response
      .status(errorCode.status)
      .contentType('application/problem+json')
      .json({
        type: 'about:blank',
        title: errorCode.status === 404 ? 'Not Found' : 'Internal Server Error',
        status: errorCode.status,
        detail: errorCode.message,
        instance: request.path,
        code: errorCode.code,
      });
  }
}
