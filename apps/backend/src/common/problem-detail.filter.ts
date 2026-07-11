import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainException } from './error-code';
import { SystemErrorCode } from './system-error-code.enum';
const BAD_REQUEST_STATUS = 400;
const NOT_FOUND_STATUS = 404;
const INTERNAL_SERVER_ERROR_STATUS = 500;
interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
}

@Catch()
export class ProblemDetailFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const instance = request.originalUrl ?? request.url;
    const problem = this.toProblemDetail(exception, request, instance);

    response
      .status(problem.status)
      .contentType('application/problem+json')
      .json(problem);
  }

  private toProblemDetail(
    exception: unknown,
    request: Request,
    instance: string,
  ): ProblemDetail {
    if (
      exception instanceof DomainException &&
      exception.errorCode.status < INTERNAL_SERVER_ERROR_STATUS
    ) {
      return {
        type: 'about:blank',
        title: this.statusTitle(exception.errorCode.status),
        status: exception.errorCode.status,
        detail: exception.errorCode.message,
        instance,
        code: exception.errorCode.code,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();

      if (status >= INTERNAL_SERVER_ERROR_STATUS) {
        this.logException('error', exception, request, instance);
        return this.systemProblem(
          status,
          instance,
          SystemErrorCode.INTERNAL_SERVER_ERROR,
        );
      }

      this.logException('debug', exception, request, instance);
      const exceptionResponse = exception.getResponse();

      return {
        type: 'about:blank',
        title: this.statusTitle(status),
        status,
        detail: this.httpExceptionDetail(exceptionResponse, exception.message),
        instance,
        code: this.httpExceptionCode(status, exceptionResponse),
      };
    }

    this.logException('error', exception, request, instance);
    return this.systemProblem(
      HttpStatus.INTERNAL_SERVER_ERROR,
      instance,
      SystemErrorCode.INTERNAL_SERVER_ERROR,
    );
  }

  private systemProblem(
    status: number,
    instance: string,
    code: SystemErrorCode,
  ): ProblemDetail {
    return {
      type: 'about:blank',
      title: this.statusTitle(status),
      status,
      detail: '예기치 못한 서버 오류가 발생했습니다.',
      instance,
      code,
    };
  }

  private httpExceptionCode(
    status: number,
    response: string | object,
  ): SystemErrorCode {
    switch (status) {
      case BAD_REQUEST_STATUS:
        return this.isValidationResponse(response)
          ? SystemErrorCode.VALIDATION_FAILED
          : SystemErrorCode.BAD_REQUEST;
      case NOT_FOUND_STATUS:
        return SystemErrorCode.ROUTE_NOT_FOUND;
      default:
        return SystemErrorCode.BAD_REQUEST;
    }
  }

  private isValidationResponse(response: string | object): boolean {
    return (
      typeof response === 'object' &&
      response !== null &&
      'message' in response &&
      Array.isArray(response.message)
    );
  }

  private httpExceptionDetail(response: string | object, fallback: string): string {
    if (typeof response === 'string') {
      return response;
    }

    if ('message' in response) {
      const message = response.message;
      return Array.isArray(message) ? message.join(', ') : String(message);
    }

    return fallback;
  }

  private logException(
    level: 'debug' | 'error',
    exception: unknown,
    request: Request,
    instance: string,
  ): void {
    const message =
      exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : undefined;
    const logMessage = `method=${request.method} url=${instance} message=${message} stack=${stack ?? '없음'}`;

    if (level === 'error') {
      this.logger.error(logMessage, stack);
      return;
    }

    this.logger.debug(logMessage);
  }

  private statusTitle(status: number): string {
    return HttpStatus[status] ?? 'Error';
  }
}
