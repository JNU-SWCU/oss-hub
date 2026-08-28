import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PurgeProgramRequestDto } from './purge-program-request.dto';

function validScope() {
  return {
    applications: 1,
    teams: 2,
    boardPosts: 3,
    submissions: 4,
    submissionEvents: 5,
    scopeFingerprint: '0123456789abcdef0123456789abcdef',
  };
}

/**
 * main.ts의 전역 ValidationPipe({ transform: true, whitelist: true,
 * forbidNonWhitelisted: true })와 같은 옵션으로 검증한다 — 여기서 통과하지 못하면
 * 컨트롤러 핸들러가 실행되기 전에 400으로 거절된다는 뜻이다.
 */
async function errors(input: object) {
  return validate(plainToInstance(PurgeProgramRequestDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('PurgeProgramRequestDto', () => {
  it('expectedScope가 온전한 정수 카운트면 통과한다', async () => {
    expect(await errors({ expectedScope: validScope() })).toHaveLength(0);
  });

  // 회귀 방지: expectedScope 자체가 없으면(빈 본문 `{}`) @ValidateNested만으로는
  // "검증할 값이 없음"으로 보고 통과시켜 컨트롤러가 undefined를 받아 비교 로직에서
  // TypeError(500)로 터졌다. @IsDefined()/@IsNotEmptyObject()가 이 경우를 400으로 막는다.
  it('본문이 비어 있으면(expectedScope 자체가 없으면) 400 대상 오류를 낸다', async () => {
    const result = await errors({});
    expect(result).not.toHaveLength(0);
    expect(result[0]?.property).toBe('expectedScope');
  });

  it('expectedScope가 null이면 400 대상 오류를 낸다', async () => {
    const result = await errors({ expectedScope: null });
    expect(result).not.toHaveLength(0);
    expect(result[0]?.property).toBe('expectedScope');
  });

  it('expectedScope가 빈 객체({})면 400 대상 오류를 낸다', async () => {
    const result = await errors({ expectedScope: {} });
    expect(result).not.toHaveLength(0);
    expect(result[0]?.property).toBe('expectedScope');
  });

  it('expectedScope가 객체가 아니면(문자열) 400 대상 오류를 낸다', async () => {
    const result = await errors({ expectedScope: 'not-an-object' });
    expect(result).not.toHaveLength(0);
    expect(result[0]?.property).toBe('expectedScope');
  });

  it('카운트 중 하나라도 정수가 아니면 400 대상 오류를 낸다', async () => {
    const result = await errors({
      expectedScope: { ...validScope(), applications: 'two' },
    });
    expect(result).not.toHaveLength(0);
  });

  it('4종 카운트 중 하나라도 음수면 400 대상 오류를 낸다', async () => {
    const result = await errors({
      expectedScope: { ...validScope(), submissions: -1 },
    });
    expect(result).not.toHaveLength(0);
  });

  it('4종 외 알 수 없는 최상위 필드가 있으면 forbidNonWhitelisted로 거절된다', async () => {
    const result = await errors({
      expectedScope: validScope(),
      extraField: 'not allowed',
    });
    expect(result.some((error) => error.property === 'extraField')).toBe(true);
  });
});
