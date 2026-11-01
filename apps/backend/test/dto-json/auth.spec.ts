import {
  LoginHistoryPageResponseDto,
  LoginHistoryResponseDto,
} from '../../src/auth/dto/login-history-response.dto';
import { LogoutResponseDto } from '../../src/auth/dto/logout-response.dto';
import {
  MeResponseDto,
  SessionResponseDto,
} from '../../src/auth/dto/session-response.dto';
import type { AuthUser, LoginHistory } from '../../src/auth/http-auth.types';

const at = (iso: string): Date => new Date(iso);

const history: LoginHistory = {
  id: 'history-1',
  event: 'LOGIN',
  provider: 'github',
  success: true,
  loginAt: at('2026-01-02T03:04:05.000Z'),
};

const user: AuthUser = {
  id: 'user-1',
  githubId: 12345n,
  nickname: 'octo',
  name: 'Octo Cat',
  avatarUrl: 'https://avatars.example/octo.png',
  accountStatus: 'ACTIVE',
  sessionVersion: 3,
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: true,
};

const cases: ReadonlyArray<readonly [string, () => unknown]> = [
  ['LoginHistoryResponseDto', () => LoginHistoryResponseDto.from(history)],
  [
    'LoginHistoryPageResponseDto',
    () =>
      LoginHistoryPageResponseDto.from({
        items: [history, { ...history, id: 'history-2', success: false }],
        page: 1,
        size: 20,
        total: 2,
      }),
  ],
  ['LogoutResponseDto', () => LogoutResponseDto.from(false)],
  ['MeResponseDto', () => MeResponseDto.from(user)],
  [
    'MeResponseDto nulls',
    () =>
      MeResponseDto.from({
        ...user,
        name: null,
        avatarUrl: null,
        memberKind: null,
      }),
  ],
  ['SessionResponseDto anonymous', () => SessionResponseDto.from()],
  ['SessionResponseDto authenticated', () => SessionResponseDto.from(user)],
];

describe('auth response DTO JSON', () => {
  it.each(cases)('%s', (_name, build) => {
    expect(JSON.stringify(build())).toMatchSnapshot();
  });
});
