import {
  GITHUB_OPERATIONS_ERROR_CODES,
  GithubOperationsError,
} from './github-app.error';
import { GithubAppClient } from './github-app.client';

const client = new GithubAppClient({
  organization: 'synthetic-org',
  accessToken: () => Promise.resolve('synthetic-token'),
  invalidateAccessToken: () => undefined,
});

function invalidResponseError(): GithubOperationsError {
  return new GithubOperationsError(
    GITHUB_OPERATIONS_ERROR_CODES.INVALID_RESPONSE,
    false,
  );
}

describe('parseRepositoryInvitations', () => {
  it('취소에 필요한 id와 login만 allowlist로 통과시킨다', () => {
    const payload = [
      {
        id: 11,
        invitee: { login: 'Synthetic-Student', email: 'private@example.com' },
        email: 'private@example.com',
        node_id: 'synthetic-node-id',
      },
    ];

    const invitations = client.parseRepositoryInvitations(payload);

    expect(invitations).toEqual([
      { invitationId: 11, login: 'Synthetic-Student' },
    ]);
  });

  it('빈 목록은 열린 초대 없음으로 파싱한다', () => {
    expect(client.parseRepositoryInvitations([])).toEqual([]);
  });

  it('배열이 아닌 응답은 응답 오류로 중단한다', () => {
    expect(() =>
      client.parseRepositoryInvitations({ invitations: [] }),
    ).toThrow(invalidResponseError());
  });

  it('invitation id가 없거나 정수가 아니면 응답 오류로 중단한다', () => {
    expect(() =>
      client.parseRepositoryInvitations([
        { invitee: { login: 'synthetic-student' } },
      ]),
    ).toThrow(invalidResponseError());
    expect(() =>
      client.parseRepositoryInvitations([
        { id: '11', invitee: { login: 'synthetic-student' } },
      ]),
    ).toThrow(invalidResponseError());
    expect(() =>
      client.parseRepositoryInvitations([
        { id: 1.5, invitee: { login: 'synthetic-student' } },
      ]),
    ).toThrow(invalidResponseError());
    expect(() =>
      client.parseRepositoryInvitations([
        { id: 0, invitee: { login: 'synthetic-student' } },
      ]),
    ).toThrow(invalidResponseError());
  });

  it('invitee login이 없거나 비면 응답 오류로 중단한다', () => {
    expect(() => client.parseRepositoryInvitations([{ id: 11 }])).toThrow(
      invalidResponseError(),
    );
    expect(() =>
      client.parseRepositoryInvitations([{ id: 11, invitee: null }]),
    ).toThrow(invalidResponseError());
    expect(() =>
      client.parseRepositoryInvitations([{ id: 11, invitee: { login: '' } }]),
    ).toThrow(invalidResponseError());
    expect(() =>
      client.parseRepositoryInvitations([{ id: 11, invitee: { login: 42 } }]),
    ).toThrow(invalidResponseError());
  });

  it('한 항목이라도 계약을 벗어나면 목록 전체를 신뢰하지 않는다', () => {
    const payload = [
      { id: 11, invitee: { login: 'synthetic-student' } },
      { id: 12, invitee: {} },
    ];

    expect(() => client.parseRepositoryInvitations(payload)).toThrow(
      invalidResponseError(),
    );
  });
});
