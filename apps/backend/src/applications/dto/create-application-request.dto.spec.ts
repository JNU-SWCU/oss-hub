import 'reflect-metadata';
import { RepositoryConnectionMode } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApplicationRequestDto } from './create-application-request.dto';

function dto(body: Record<string, unknown>): CreateApplicationRequestDto {
  return plainToInstance(CreateApplicationRequestDto, {
    answers: { title: '제목', summary: '요약' },
    teamId: null,
    applicationTemplateVersion: 1,
    ...body,
  });
}

/**
 * #414 DEC-33/34 — isRepositoryPublicationPlanned 는 구 클라이언트가 생략해도
 * true 로 기본 설정되고(old-client-omission), 명시적 false 는 그대로 왕복해야 한다.
 *
 * repositoryConnectionMode / repositoryUrl 계약:
 * - NEW + url 없음 → 성공
 * - NEW + url 있음 → 400
 * - OWN + url 없음 → 400
 * - OWN + 유효 url → 성공
 * - 두 필드 미지정 → NEW + null
 */
describe('CreateApplicationRequestDto.toInput', () => {
  it('구 클라이언트가 필드를 생략하면 true 로 기본 설정한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
    });

    expect(body.toInput().isRepositoryPublicationPlanned).toBe(true);
  });

  it('명시적 true 는 그대로 유지한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });

    expect(body.toInput().isRepositoryPublicationPlanned).toBe(true);
  });

  it('명시적 false 는 true 로 덮어쓰지 않고 그대로 왕복한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: false,
    });

    expect(body.toInput().isRepositoryPublicationPlanned).toBe(false);
  });

  it('두 필드 미지정(구 클라이언트)은 NEW + null 로 정규화한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
    });

    expect(body.toInput()).toMatchObject({
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });
  });

  it('NEW + repositoryUrl 없음은 성공하고 null 로 저장 입력을 만든다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
    });

    expect(body.toInput()).toMatchObject({
      repositoryConnectionMode: RepositoryConnectionMode.NEW,
      repositoryUrl: null,
    });
  });

  it('OWN + 유효 URL 은 성공하고 저장 입력에 실린다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      teamId: null,
      applicationTemplateVersion: 1,
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
    });

    expect(body.toInput()).toMatchObject({
      repositoryConnectionMode: RepositoryConnectionMode.OWN,
      repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
    });
  });
});

describe('CreateApplicationRequestDto validation — repository connection', () => {
  it('NEW + repositoryUrl 없음 → 통과', async () => {
    const errors = await validate(
      dto({ repositoryConnectionMode: RepositoryConnectionMode.NEW }),
    );
    expect(errors).toHaveLength(0);
  });

  it('NEW + repositoryUrl 있음 → 거부', async () => {
    const errors = await validate(
      dto({
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
      }),
    );
    expect(errors.some((error) => error.property === 'repositoryUrl')).toBe(
      true,
    );
  });

  it('OWN + repositoryUrl 없음 → 거부', async () => {
    const errors = await validate(
      dto({ repositoryConnectionMode: RepositoryConnectionMode.OWN }),
    );
    expect(errors.some((error) => error.property === 'repositoryUrl')).toBe(
      true,
    );
  });

  it('OWN + 유효 URL → 통과', async () => {
    const errors = await validate(
      dto({
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'https://github.com/synthetic-org/synthetic-repo',
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('두 필드 미지정(구 클라이언트) → 통과 후 NEW + null', async () => {
    const body = dto({});
    const errors = await validate(body);
    expect(errors).toHaveLength(0);
    expect(body.toInput()).toEqual(
      expect.objectContaining({
        repositoryConnectionMode: RepositoryConnectionMode.NEW,
        repositoryUrl: null,
      }),
    );
  });

  it('OWN + 비-URL 문자열 → 거부', async () => {
    const errors = await validate(
      dto({
        repositoryConnectionMode: RepositoryConnectionMode.OWN,
        repositoryUrl: 'not-a-url',
      }),
    );
    expect(errors.some((error) => error.property === 'repositoryUrl')).toBe(
      true,
    );
  });
});
