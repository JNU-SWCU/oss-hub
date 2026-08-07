import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { createApplication } from './api';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
  ApiError: class extends Error {},
}));

/**
 * 신청 생성 요청 본문의 키가 backend DTO 가 whitelist 하는 키의 부분집합인지 검사한다.
 *
 * 왜 이 검사가 따로 필요한가 — 2026-08-05 v0.6.31 부터 8/7 까지 배포 운영에서 **모든
 * 신규 신청 제출이 400 으로 실패했다.** #651 이 backend DTO 의 `teamId` 를 `teamName`
 * 으로 바꾸면서 이 파일이 보내는 본문을 함께 고치지 않았고, 전역 `ValidationPipe` 가
 * `forbidNonWhitelisted: true` 라 미허용 키가 하나 있다는 것만으로 본문 전체가 거절됐다.
 *
 * 그때 양쪽 테스트가 모두 초록불이었다. frontend 는 자기가 만든 본문을, backend 는 자기
 * DTO 를 각자 검증했고 **두 쪽을 마주 보게 하는 검사가 없었기 때문**이다. 그래서 이
 * 테스트는 mock 한 기대값이 아니라 **backend DTO 소스를 직접 읽어** 대조한다. 한쪽만
 * 고치면 여기서 빨간불이 난다.
 */
const DTO_PATH = fileURLToPath(
  new URL(
    '../../../../backend/src/applications/dto/create-application-request.dto.ts',
    import.meta.url,
  ),
);

/**
 * DTO 가 whitelist 하는 키의 **현재 계약**. DTO 를 바꾸면 이 목록도 바꿔야 하고,
 * 그 순간 «보내는 쪽도 같이 봤는가»를 묻게 된다 — 그게 이 상수의 존재 이유다.
 * 부분집합 검사만으로는 **새 필수 필드가 DTO 에 생겨도 조용히 통과**한다.
 */
const EXPECTED_DTO_KEYS = [
  'answers',
  'applicationTemplateVersion',
  'isRepositoryPublicationPlanned',
  'repositoryConnectionMode',
  'repositoryUrl',
  'teamName',
] as const;

interface DtoKey {
  readonly name: string;
  readonly optional: boolean;
}

/** DTO 클래스의 `declare readonly <name>[?]:` 선언에서 키와 선택 여부를 뽑는다. */
function backendDtoKeys(): readonly DtoKey[] {
  const source = readFileSync(DTO_PATH, 'utf8');
  const keys = [...source.matchAll(/declare\s+readonly\s+(\w+)(\?)?\s*:/g)].map(
    (match) => ({ name: match[1], optional: match[2] === '?' }),
  );
  // 파싱이 깨졌는데 조용히 통과하는 일을 막는다.
  expect(keys.length).toBeGreaterThanOrEqual(EXPECTED_DTO_KEYS.length);
  return keys;
}

async function sentBodyKeys(): Promise<readonly string[]> {
  vi.mocked(apiClient).mockResolvedValue({});
  await createApplication('program-1', {
    answers: { title: '제목', summary: '요약' },
    applicationTemplateVersion: 1,
    isRepositoryPublicationPlanned: true,
    repositoryConnectionMode: 'new',
    repositoryUrl: '',
  });
  const call = vi.mocked(apiClient).mock.calls[0];
  const init = call[1] as { readonly body: string };
  return Object.keys(JSON.parse(init.body) as Record<string, unknown>);
}

describe('createApplication wire 계약', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockReset();
  });

  it('보내는 키가 전부 backend DTO 의 whitelist 안에 있다', async () => {
    const allowed = backendDtoKeys().map((key) => key.name);
    const sent = await sentBodyKeys();

    const notAllowed = sent.filter((key) => !allowed.includes(key));
    expect(notAllowed).toEqual([]);
  });

  it('DTO 가 요구하는 필수 키를 빠짐없이 보낸다', async () => {
    const required = backendDtoKeys()
      .filter((key) => !key.optional)
      .map((key) => key.name);
    const sent = await sentBodyKeys();

    const missing = required.filter((key) => !sent.includes(key));
    expect(missing).toEqual([]);
  });

  it('DTO 의 키 집합이 이 테스트가 아는 계약과 같다', async () => {
    // 위 두 검사만으로는 DTO 에 **새 필수 필드가 생겨도** 조용히 통과한다
    // (보내는 쪽은 그대로여도 «부분집합»과 «필수 포함»이 함께 깨지지 않는 조합이 있다).
    // DTO 가 바뀌면 여기서 먼저 멈춰 세워 보내는 쪽을 함께 보게 한다.
    expect(
      backendDtoKeys()
        .map((key) => key.name)
        .sort(),
    ).toEqual([...EXPECTED_DTO_KEYS].sort());
  });
});
