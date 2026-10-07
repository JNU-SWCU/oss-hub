import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DeleteTeamRequestDto } from './delete-team-request.dto';

function validScope() {
  return {
    applications: 1,
    members: 3,
    invitations: 2,
    submissions: 4,
    submissionEvents: 5,
    detachedRepositories: 1,
    scopeFingerprint: '0123456789abcdef0123456789abcdef',
  };
}

async function errors(input: object) {
  return validate(plainToInstance(DeleteTeamRequestDto, input), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('DeleteTeamRequestDto', () => {
  it('expectedScope 가 온전한 정수 카운트와 지문이면 통과한다', async () => {
    expect(await errors({ expectedScope: validScope() })).toHaveLength(0);
  });

  it.each([
    ['본문이 비어 있으면', {}],
    ['null 이면', { expectedScope: null }],
    ['빈 객체면', { expectedScope: {} }],
    ['객체가 아니면', { expectedScope: 'not-an-object' }],
  ])('expectedScope 가 %s 400 대상 오류를 낸다', async (_label, input) => {
    const result = await errors(input);
    expect(result).not.toHaveLength(0);
    expect(result[0]?.property).toBe('expectedScope');
  });

  it.each([
    'applications',
    'members',
    'invitations',
    'submissions',
    'submissionEvents',
    'detachedRepositories',
  ])('%s 가 정수가 아니면 거절한다', async (key) => {
    expect(
      await errors({ expectedScope: { ...validScope(), [key]: 'two' } }),
    ).not.toHaveLength(0);
  });

  it.each([
    'applications',
    'members',
    'invitations',
    'submissions',
    'submissionEvents',
    'detachedRepositories',
  ])('%s 가 음수면 거절한다', async (key) => {
    expect(
      await errors({ expectedScope: { ...validScope(), [key]: -1 } }),
    ).not.toHaveLength(0);
  });

  it.each([undefined, '', 'not-a-digest', '0123456789ABCDEF0123456789ABCDEF'])(
    'scopeFingerprint 가 %p 면 거절한다',
    async (scopeFingerprint) => {
      expect(
        await errors({
          expectedScope: { ...validScope(), scopeFingerprint },
        }),
      ).not.toHaveLength(0);
    },
  );

  it('모르는 필드가 오면 거절한다', async () => {
    const result = await errors({
      expectedScope: validScope(),
      extraField: 'not allowed',
    });
    expect(result.some((error) => error.property === 'extraField')).toBe(true);
  });
});
