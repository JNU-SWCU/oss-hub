import 'reflect-metadata';
import { validate } from 'class-validator';
import { AuditLogListRequestDto } from './audit-log-query.dto';

describe('AuditLogListRequestDto', () => {
  it('기간 필터는 한국 날짜 선택기의 YYYY-MM-DD만 허용한다', async () => {
    const dto = Object.assign(new AuditLogListRequestDto(), {
      from: '2026-07-24T00:00:00.000Z',
      to: 'not-a-date',
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property).sort()).toEqual([
      'from',
      'to',
    ]);
  });

  it('page는 1 이상이고 limit은 1부터 100까지만 허용한다', async () => {
    const dto = Object.assign(new AuditLogListRequestDto(), {
      page: 0,
      limit: 101,
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property).sort()).toEqual([
      'limit',
      'page',
    ]);
  });

  it('생략한 페이지네이션 값은 첫 페이지 20건으로 변환한다', () => {
    const dto = new AuditLogListRequestDto();

    expect(dto.toQuery()).toEqual({ page: 1, limit: 20 });
  });
});
