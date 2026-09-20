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
      view: 'default',
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

  it('search 를 trim 하고 status 를 보존한다', async () => {
    const query = plainToInstance(ApplicationListQueryRequestDto, {
      page: '2',
      pageSize: '10',
      search: '  team-alpha  ',
      status: 'APPROVED',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    expect(query.toQuery()).toEqual({
      page: 2,
      pageSize: 10,
      search: 'team-alpha',
      status: 'APPROVED',
      view: 'default',
    });
  });

  it('구 클라이언트의 mode 쿼리는 수용하되 toQuery 결과에 넣지 않는다', async () => {
    const query = plainToInstance(ApplicationListQueryRequestDto, {
      page: '1',
      pageSize: '20',
      search: '',
      status: 'all',
      mode: 'personal',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    expect(query.mode).toBe('personal');
    expect(query.toQuery()).toEqual({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'all',
      view: 'default',
    });
    expect(query.toQuery()).not.toHaveProperty('mode');
  });
});

describe('ApplicationListQueryRequestDto — view projection 선택', () => {
  it('view 를 주지 않으면 기존 응답 모양(default)을 고른다', async () => {
    const query = plainToInstance(ApplicationListQueryRequestDto, {});

    expect(await validate(query)).toHaveLength(0);
    expect(query.toQuery().view).toBe('default');
  });

  it('team-management 를 명시하면 그대로 전달한다', async () => {
    const query = plainToInstance(ApplicationListQueryRequestDto, {
      view: 'team-management',
    });

    expect(await validate(query)).toHaveLength(0);
    expect(query.toQuery().view).toBe('team-management');
  });

  it('모르는 view 는 400 으로 거절한다 — 조용히 default 로 떨어뜨리지 않는다', async () => {
    const query = plainToInstance(ApplicationListQueryRequestDto, {
      view: 'whatever',
    });

    const errors = await validate(query);

    expect(errors.map((error) => error.property)).toContain('view');
  });
});
