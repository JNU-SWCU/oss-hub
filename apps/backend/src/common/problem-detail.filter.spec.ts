import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainException } from './error-code';
import { ProblemDetailFilter } from './problem-detail.filter';
import { SystemErrorCode } from './system-error-code.enum';

describe('ProblemDetailFilter', () => {
  const createHost = (
    response: Response,
    url = '/api/v1/members/missing',
  ): ArgumentsHost =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ method: 'GET', originalUrl: url }),
        getResponse: () => response,
      }),
    }) as ArgumentsHost;

  const createResponse = (): {
    response: Response;
    json: jest.Mock;
    contentType: jest.Mock;
    status: jest.Mock;
  } => {
    const json = jest.fn();
    const contentType = jest.fn().mockReturnThis();
    const status = jest.fn().mockReturnThis();

    return {
      response: { json, contentType, status } as unknown as Response,
      json,
      contentType,
      status,
    };
  };

  it('도메인 예외를 ProblemDetail 형식으로 반환한다', () => {
    const { response, json, contentType, status } = createResponse();
    const exception = new DomainException({
      code: 'MEM_001',
      status: 404,
      message: '회원을 찾을 수 없습니다.',
    });

    new ProblemDetailFilter().catch(exception, createHost(response));

    expect(status).toHaveBeenCalledWith(404);
    expect(contentType).toHaveBeenCalledWith('application/problem+json');
    expect(json).toHaveBeenCalledWith({
      type: 'about:blank',
      title: 'NOT_FOUND',
      status: 404,
      detail: '회원을 찾을 수 없습니다.',
      instance: '/api/v1/members/missing',
      code: 'MEM_001',
    });
  });

  it('도메인 예외의 retryNotBeforeAt 확장 필드를 보존한다', () => {
    const { response, json } = createResponse();
    const retryNotBeforeAt = '2026-01-01T00:01:00.000Z';
    const exception = new DomainException(
      {
        code: 'COL_001',
        status: 429,
        message: 'GitHub API 요청 한도에 도달했습니다.',
      },
      { retryNotBeforeAt },
    );

    new ProblemDetailFilter().catch(
      exception,
      createHost(response, '/api/v1/collection-runs'),
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'COL_001',
        status: 429,
        retryNotBeforeAt,
      }),
    );
  });

  it.each([
    [
      '일반 잘못된 요청',
      new BadRequestException('요청 형식이 올바르지 않습니다.'),
      SystemErrorCode.BAD_REQUEST,
    ],
    [
      '검증 오류',
      new BadRequestException({
        message: ['회원 ID 형식이 올바르지 않습니다.'],
        error: 'Bad Request',
        statusCode: HttpStatus.BAD_REQUEST,
      }),
      SystemErrorCode.VALIDATION_FAILED,
    ],
    ['없는 경로', new NotFoundException(), SystemErrorCode.ROUTE_NOT_FOUND],
  ])(
    '4xx framework 예외(%s)는 해당 시스템 코드를 반환하고 debug 로그를 남긴다',
    (
      _description: string,
      exception: HttpException,
      expectedCode: SystemErrorCode,
    ) => {
      const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
      const { response, json } = createResponse();

      new ProblemDetailFilter().catch(exception, createHost(response));

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: exception.getStatus(),
          code: expectedCode,
        }),
      );
      expect(debug).toHaveBeenCalledWith(
        expect.stringContaining(
          `method=GET url=/api/v1/members/missing message=${exception.message}`,
        ),
      );

      debug.mockRestore();
    },
  );

  it('5xx framework 예외는 진단을 error 로그에 남기고 응답을 sanitize한다', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { response, json } = createResponse();
    const exception = new InternalServerErrorException('민감한 내부 오류');

    new ProblemDetailFilter().catch(exception, createHost(response));

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(
        'method=GET url=/api/v1/members/missing message=민감한 내부 오류 stack=',
      ),
      exception.stack,
    );
    expect(json).toHaveBeenCalledWith({
      type: 'about:blank',
      title: 'INTERNAL_SERVER_ERROR',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: '예기치 못한 서버 오류가 발생했습니다.',
      instance: '/api/v1/members/missing',
      code: SystemErrorCode.INTERNAL_SERVER_ERROR,
    });

    error.mockRestore();
  });

  it('unknown 예외는 진단을 error 로그에 남기고 응답을 sanitize한다', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { response, json } = createResponse();
    const exception = new Error('데이터베이스 연결 문자열 노출');

    new ProblemDetailFilter().catch(exception, createHost(response));

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(
        'method=GET url=/api/v1/members/missing message=데이터베이스 연결 문자열 노출 stack=',
      ),
      exception.stack,
    );
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        detail: '예기치 못한 서버 오류가 발생했습니다.',
        code: SystemErrorCode.INTERNAL_SERVER_ERROR,
      }),
    );

    error.mockRestore();
  });
});
