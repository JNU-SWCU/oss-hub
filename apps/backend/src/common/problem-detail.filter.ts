import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainException } from './error-code';

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
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();
    const problem = this.toProblemDetail(exception, request.originalUrl ?? request.url);

    response
      .status(problem.status)
      .contentType('application/problem+json')
      .json(problem);
  }

  private toProblemDetail(exception: unknown, instance: string): ProblemDetail {
    if (exception instanceof DomainException) {
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
      const exceptionResponse = exception.getResponse();
      const detail = this.httpExceptionDetail(exceptionResponse, exception.message);

      return {
        type: 'about:blank',
        title: this.statusTitle(status),
        status,
        detail,
        instance,
        code: 'SYS_001',
      };
    }

    return {
      type: 'about:blank',
      title: this.statusTitle(HttpStatus.INTERNAL_SERVER_ERROR),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: '예기치 못한 서버 오류가 발생했습니다.',
      instance,
      code: 'SYS_001',
    };
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

  private statusTitle(status: number): string {
    return HttpStatus[status] ?? 'Error';
  }
}
