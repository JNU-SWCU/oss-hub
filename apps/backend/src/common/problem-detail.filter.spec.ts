import { ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { DomainException } from './error-code';
import { ProblemDetailFilter } from './problem-detail.filter';

describe('ProblemDetailFilter', () => {
  it('도메인 예외를 ProblemDetail 형식으로 반환한다', () => {
    const json = jest.fn();
    const contentType = jest.fn().mockReturnThis();
    const status = jest.fn().mockReturnThis();
    const response = { json, contentType, status } as unknown as Response;
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ originalUrl: '/api/v1/members/missing' }),
        getResponse: () => response,
      }),
    } as ArgumentsHost;
    const exception = new DomainException({
      code: 'MEM_001',
      status: 404,
      message: '회원을 찾을 수 없습니다.',
    });

    new ProblemDetailFilter().catch(exception, host);

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
});
