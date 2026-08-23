import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AdminAccessHistoryRequestDto } from './admin-access-query.dto';

/**
 * bridge 전용 이중 철자 질의.
 *
 * 직전 프런트엔드 번들(v0.6.110)은 `roleRequestPage`/`roleRequestLimit`을 보낸다.
 * 전역 `ValidationPipe`가 `forbidNonWhitelisted: true`라 그 키를 DTO가 모르면
 * **요청 전체가 400**이 된다 — 그래서 legacy 별칭을 함께 받는다.
 *
 * 충돌은 추측하지 않고 거절한다. 어느 한쪽을 조용히 이기게 하면 관리자가 본 페이지와
 * 서버가 센 페이지가 갈라지고, 그 갈라짐은 화면에 아무 징후도 남기지 않는다.
 */
function parse(query: Record<string, unknown>): AdminAccessHistoryRequestDto {
  const dto = plainToInstance(AdminAccessHistoryRequestDto, query, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(dto, { whitelist: true });
  expect(errors).toEqual([]);
  return dto;
}

describe('AdminAccessHistoryRequestDto dual spelling', () => {
  it('legacy 철자만 실려도 정본 질의로 옮겨진다', () => {
    // When
    const query = parse({ roleRequestPage: 2, roleRequestLimit: 5 }).toQuery();

    // Then
    expect(query.staffAccessRequests).toEqual({ page: 2, limit: 5 });
  });

  it('정본 철자만 실려도 그대로 쓰인다', () => {
    // When
    const query = parse({
      staffAccessRequestPage: 3,
      staffAccessRequestLimit: 7,
    }).toQuery();

    // Then
    expect(query.staffAccessRequests).toEqual({ page: 3, limit: 7 });
  });

  it('두 철자가 같은 값이면 충돌이 아니다', () => {
    // When
    const query = parse({
      staffAccessRequestPage: 2,
      roleRequestPage: 2,
      staffAccessRequestLimit: 4,
      roleRequestLimit: 4,
    }).toQuery();

    // Then
    expect(query.staffAccessRequests).toEqual({ page: 2, limit: 4 });
  });

  it.each([
    ['page', { staffAccessRequestPage: 1, roleRequestPage: 2 }],
    ['limit', { staffAccessRequestLimit: 10, roleRequestLimit: 20 }],
  ])('두 철자가 다른 %s를 실으면 거절한다', (_label, query) => {
    // When / Then — 추측하지 않는다.
    expect(() => parse(query).toQuery()).toThrow(BadRequestException);
  });

  it('legacy 별칭도 정본과 똑같은 범위 검증을 받는다', () => {
    // Given — legacy라고 검증을 느슨하게 하면 그쪽이 우회로가 된다.
    const dto = plainToInstance(AdminAccessHistoryRequestDto, {
      roleRequestPage: 0,
      roleRequestLimit: 101,
    });

    // When
    const errors = validateSync(dto, { whitelist: true });

    // Then
    expect(errors.map((error) => error.property).sort()).toEqual([
      'roleRequestLimit',
      'roleRequestPage',
    ]);
  });

  it('아무것도 실리지 않으면 기본 페이지를 쓴다', () => {
    // When
    const query = parse({}).toQuery();

    // Then
    expect(query.staffAccessRequests).toEqual({ page: 1, limit: 20 });
    expect(query.loginHistory).toEqual({ page: 1, limit: 20 });
  });
});
