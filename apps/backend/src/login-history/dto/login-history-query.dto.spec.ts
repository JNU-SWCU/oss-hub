import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginHistoryQueryRequestDto } from './login-history-query.dto';

describe('LoginHistoryQueryRequestDto', () => {
  it('페이지 조건이 없으면 첫 20건을 사용한다', async () => {
    const query = plainToInstance(LoginHistoryQueryRequestDto, {});

    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    expect(query).toMatchObject({ page: 1, size: 20 });
  });

  it('페이지 크기가 100을 넘으면 거부한다', async () => {
    const query = plainToInstance(LoginHistoryQueryRequestDto, {
      page: '1',
      size: '101',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('size');
  });
});
