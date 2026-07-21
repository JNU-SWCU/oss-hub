import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginHistoryQueryDto } from './login-history-query.dto';

describe('LoginHistoryQueryDto', () => {
  it('페이지 조건이 없으면 첫 20건을 사용한다', async () => {
    // Given: 페이지 query가 없다.
    const query = plainToInstance(LoginHistoryQueryDto, {});

    // When: query를 검증한다.
    const errors = await validate(query);

    // Then: 기본 페이지 조건이 유효하다.
    expect(errors).toHaveLength(0);
    expect(query).toMatchObject({ page: 1, size: 20 });
  });

  it('페이지 크기가 100을 넘으면 거부한다', async () => {
    // Given: 최대값을 넘는 페이지 query가 있다.
    const query = plainToInstance(LoginHistoryQueryDto, {
      page: '1',
      size: '101',
    });

    // When: query를 검증한다.
    const errors = await validate(query);

    // Then: size 필드가 유효하지 않다.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('size');
  });
});
