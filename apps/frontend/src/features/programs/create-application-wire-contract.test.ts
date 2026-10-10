import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '@/lib/api-client';
import { createApplication } from './api';

vi.mock('@/lib/api-client', () => ({
  apiClient: vi.fn(),
  ApiError: class extends Error {},
}));

const DTO_PATH = fileURLToPath(
  new URL(
    '../../../../backend/src/applications/dto/create-application-request.dto.ts',
    import.meta.url,
  ),
);

const EXPECTED_DTO_KEYS = [
  'answers',
  'applicationTemplateVersion',
  'isRepositoryPublicationPlanned',
  'teamName',
] as const;

interface DtoKey {
  readonly name: string;
  readonly optional: boolean;
}

function backendDtoKeys(): readonly DtoKey[] {
  const source = readFileSync(DTO_PATH, 'utf8');
  const keys = [...source.matchAll(/declare\s+readonly\s+(\w+)(\?)?\s*:/g)].map(
    (match) => ({ name: match[1], optional: match[2] === '?' }),
  );

  expect(keys.length).toBeGreaterThanOrEqual(EXPECTED_DTO_KEYS.length);
  return keys;
}

async function sentBodyKeys(): Promise<readonly string[]> {
  vi.mocked(apiClient).mockResolvedValue({});
  await createApplication('program-1', {
    answers: {},
    applicationTemplateVersion: 1,
    isRepositoryPublicationPlanned: true,
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

  it('DTO 의 키 집합이 이 테스트가 아는 계약과 같다', () => {
    expect(
      backendDtoKeys()
        .map((key) => key.name)
        .sort(),
    ).toEqual([...EXPECTED_DTO_KEYS].sort());
  });
});
