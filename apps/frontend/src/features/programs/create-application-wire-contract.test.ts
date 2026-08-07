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

/** DTO 클래스의 `declare readonly <name>` 선언에서 whitelist 키를 뽑는다. */
function backendWhitelistedKeys(): readonly string[] {
  const source = readFileSync(DTO_PATH, 'utf8');
  const keys = [...source.matchAll(/declare\s+readonly\s+(\w+)\??\s*:/g)].map(
    (match) => match[1],
  );
  // 파싱이 깨졌는데 조용히 통과하는 일을 막는다 — DTO 는 최소 5개 필드를 갖는다.
  expect(keys.length).toBeGreaterThanOrEqual(5);
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

  it('보내는 키가 backend DTO whitelist 의 부분집합이다', async () => {
    const allowed = backendWhitelistedKeys();
    const sent = await sentBodyKeys();

    const notAllowed = sent.filter((key) => !allowed.includes(key));
    expect(notAllowed).toEqual([]);
  });

  it('DTO 가 요구하는 필수 키를 빠짐없이 보낸다', async () => {
    const sent = await sentBodyKeys();

    // `teamName`·`isRepositoryPublicationPlanned` 등은 @IsOptional 이라 제외한다.
    expect(sent).toContain('answers');
    expect(sent).toContain('applicationTemplateVersion');
  });
});
