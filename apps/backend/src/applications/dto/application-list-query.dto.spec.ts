import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplicationListQueryRequestDto } from './application-list-query.dto';

describe('ApplicationListQueryRequestDto', () => {
  it('빈 쿼리에서 기본 페이지·필터를 사용한다', async () => {
    const query = plainToInstance(ApplicationListQueryRequestDto, {});

    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    expect(query.toQuery()).toEqual({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'all',
      mode: 'all',
    });
  });

  it('pageSize 상한을 초과하면 거부한다', async () => {
    const query = plainToInstance(ApplicationListQueryRequestDto, {
      page: '1',
      pageSize: '101',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('pageSize');
  });

  it('지원하지 않는 status 를 거부한다', async () => {
    const query = plainToInstance(ApplicationListQueryRequestDto, {
      status: 'PENDING',
    });

    const errors = await validate(query);

    expect(errors.some((error) => error.property === 'status')).toBe(true);
  });

  it('search 를 trim 하고 mode·status 를 보존한다', async () => {
    const query = plainToInstance(ApplicationListQueryRequestDto, {
      page: '2',
      pageSize: '10',
      search: '  team-alpha  ',
      status: 'APPROVED',
      mode: 'team',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    expect(query.toQuery()).toEqual({
      page: 2,
      pageSize: 10,
      search: 'team-alpha',
      status: 'APPROVED',
      mode: 'team',
    });
  });
});
