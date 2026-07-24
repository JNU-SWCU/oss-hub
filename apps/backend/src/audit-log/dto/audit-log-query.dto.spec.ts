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
});
