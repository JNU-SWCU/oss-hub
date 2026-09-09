import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApplicationRequestDto } from './create-application-request.dto';

function dto(body: Record<string, unknown>): CreateApplicationRequestDto {
  return plainToInstance(CreateApplicationRequestDto, {
    answers: { title: '제목', summary: '요약' },
    applicationTemplateVersion: 1,
    ...body,
  });
}

/**
 * #414 DEC-33/34 — isRepositoryPublicationPlanned 는 구 클라이언트가 생략해도
 * true 로 기본 설정되고(old-client-omission), 명시적 false 는 그대로 왕복해야 한다.
 *
 */
describe('CreateApplicationRequestDto.toInput', () => {
  it('구 클라이언트가 필드를 생략하면 true 로 기본 설정한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
    });

    expect(body.toInput().isRepositoryPublicationPlanned).toBe(true);
  });

  it('명시적 true 는 그대로 유지한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });

    expect(body.toInput().isRepositoryPublicationPlanned).toBe(true);
  });

  it('명시적 false 는 true 로 덮어쓰지 않고 그대로 왕복한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: false,
    });

    expect(body.toInput().isRepositoryPublicationPlanned).toBe(false);
  });

  it('teamName 미입력을 null 로 정규화한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
    });

    expect(body.toInput().teamName).toBeNull();
  });

  it('teamName 공백은 null 로 정규화한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
      teamName: '   ',
    });

    expect(body.toInput().teamName).toBeNull();
  });

  it('teamName 은 trim 한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목', summary: '요약' },
      applicationTemplateVersion: 1,
      teamName: '  오픈소스팀  ',
    });

    expect(body.toInput().teamName).toBe('오픈소스팀');
  });
});

describe('CreateApplicationRequestDto validation', () => {
  it.each([
    { repositoryConnectionMode: 'NEW' },
    { repositoryConnectionMode: 'OWN' },
    { repositoryUrl: null },
    { repositoryUrl: 'https://github.com/synthetic/repository' },
  ])('rejects obsolete selection input %j', async (fields) => {
    // Given
    const body = dto(fields);
    // When
    const errors = await validate(body, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    // Then
    expect(errors).not.toHaveLength(0);
  });

  it('keeps repository selection out of the creation input', () => {
    // Given
    const body = dto({});
    // When
    const input = body.toInput();
    // Then
    expect(input).toEqual({
      answers: { title: '제목', summary: '요약' },
      teamName: null,
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });
  });

  it('rejects team names longer than 100 characters', async () => {
    // Given / When
    const errors = await validate(dto({ teamName: 'x'.repeat(101) }));
    // Then
    expect(errors.some((error) => error.property === 'teamName')).toBe(true);
  });
});
