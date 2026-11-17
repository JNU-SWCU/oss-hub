import { TeamApplicationService } from '../team-application.service';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplicationListRequestDto } from './application-list-request.dto';

const applicationsService = Object.create(
  TeamApplicationService.prototype,
) as TeamApplicationService;

describe('ApplicationListRequestDto', () => {
  it('빈 쿼리에서 기본 페이지·필터를 사용한다', async () => {
    const query = plainToInstance(ApplicationListRequestDto, {});

    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    expect(applicationsService.listQueryFromRequest(query)).toEqual({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'all',
    });
  });

  it('pageSize 상한을 초과하면 거부한다', async () => {
    const query = plainToInstance(ApplicationListRequestDto, {
      page: '1',
      pageSize: '101',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.property).toBe('pageSize');
  });

  it('지원하지 않는 status 를 거부한다', async () => {
    const query = plainToInstance(ApplicationListRequestDto, {
      status: 'PENDING',
    });

    const errors = await validate(query);

    expect(errors.some((error) => error.property === 'status')).toBe(true);
  });

  it('search 를 trim 하고 status 를 보존한다', async () => {
    const query = plainToInstance(ApplicationListRequestDto, {
      page: '2',
      pageSize: '10',
      search: '  team-alpha  ',
      status: 'APPROVED',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    expect(applicationsService.listQueryFromRequest(query)).toEqual({
      page: 2,
      pageSize: 10,
      search: 'team-alpha',
      status: 'APPROVED',
    });
  });

  it('구 클라이언트의 mode 쿼리는 수용하되 toQuery 결과에 넣지 않는다', async () => {
    const query = plainToInstance(ApplicationListRequestDto, {
      page: '1',
      pageSize: '20',
      search: '',
      status: 'all',
      mode: 'personal',
    });

    const errors = await validate(query);

    expect(errors).toHaveLength(0);
    expect(query.mode).toBe('personal');
    expect(applicationsService.listQueryFromRequest(query)).toEqual({
      page: 1,
      pageSize: 20,
      search: '',
      status: 'all',
    });
    expect(applicationsService.listQueryFromRequest(query)).not.toHaveProperty(
      'mode',
    );
  });
});

describe('ApplicationListRequestDto — 폐기된 view', () => {
  it('예전 view 값을 보내도 검증을 통과하고 질의에는 싣지 않는다', async () => {
    const query = plainToInstance(ApplicationListRequestDto, {
      view: 'team-management',
    });

    expect(await validate(query)).toHaveLength(0);
    expect(applicationsService.listQueryFromRequest(query)).not.toHaveProperty(
      'view',
    );
  });
});
