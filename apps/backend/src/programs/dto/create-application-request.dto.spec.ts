import { TeamApplicationService } from '../team-application.service';
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateApplicationRequestDto } from './create-application-request.dto';

const applicationsService = Object.create(
  TeamApplicationService.prototype,
) as TeamApplicationService;

function dto(body: Record<string, unknown>): CreateApplicationRequestDto {
  return plainToInstance(CreateApplicationRequestDto, {
    answers: { title: '제목' },
    applicationTemplateVersion: 1,
    ...body,
  });
}

describe('CreateApplicationRequestDto.toInput', () => {
  it('지명한 학생 ID 배열을 검증하고 지원 입력에 보존한다', async () => {
    const body = dto({ inviteeUserIds: ['student-a', 'student-b'] });
    expect(await validate(body)).toHaveLength(0);
    expect(
      applicationsService.createInputFromRequest(body).inviteeUserIds,
    ).toEqual(['student-a', 'student-b']);
  });

  it.each([{ value: 'student-a' }, { value: [1] }, { value: [true] }])(
    '잘못된 학생 ID 입력 %j를 거부한다',
    async ({ value }) => {
      const errors = await validate(dto({ inviteeUserIds: value }));
      expect(errors.some((error) => error.property === 'inviteeUserIds')).toBe(
        true,
      );
    },
  );

  it('구 클라이언트가 필드를 생략하면 true 로 기본 설정한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목' },
      applicationTemplateVersion: 1,
    });

    expect(
      applicationsService.createInputFromRequest(body)
        .isRepositoryPublicationPlanned,
    ).toBe(true);
  });

  it('명시적 true 는 그대로 유지한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목' },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });

    expect(
      applicationsService.createInputFromRequest(body)
        .isRepositoryPublicationPlanned,
    ).toBe(true);
  });

  it('명시적 false 는 true 로 덮어쓰지 않고 그대로 왕복한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목' },
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: false,
    });

    expect(
      applicationsService.createInputFromRequest(body)
        .isRepositoryPublicationPlanned,
    ).toBe(false);
  });

  it('teamName 미입력을 null 로 정규화한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목' },
      applicationTemplateVersion: 1,
    });

    expect(
      applicationsService.createInputFromRequest(body).teamName,
    ).toBeNull();
  });

  it('teamName 공백은 null 로 정규화한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목' },
      applicationTemplateVersion: 1,
      teamName: '   ',
    });

    expect(
      applicationsService.createInputFromRequest(body).teamName,
    ).toBeNull();
  });

  it('teamName 은 trim 한다', () => {
    const body = Object.assign(new CreateApplicationRequestDto(), {
      answers: { title: '제목' },
      applicationTemplateVersion: 1,
      teamName: '  오픈소스팀  ',
    });

    expect(applicationsService.createInputFromRequest(body).teamName).toBe(
      '오픈소스팀',
    );
  });
});

describe('CreateApplicationRequestDto validation', () => {
  it.each([
    { repositoryConnectionMode: 'NEW' },
    { repositoryConnectionMode: 'OWN' },
    { repositoryUrl: null },
    { repositoryUrl: 'https://github.com/synthetic/repository' },
  ])('rejects obsolete selection input %j', async (fields) => {
    const body = dto(fields);

    const errors = await validate(body, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    expect(errors).not.toHaveLength(0);
  });

  it('keeps repository selection out of the creation input', () => {
    const body = dto({});

    const input = applicationsService.createInputFromRequest(body);

    expect(input).toEqual({
      inviteeUserIds: [],
      answers: { title: '제목' },
      teamName: null,
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: true,
    });
  });

  it('rejects team names longer than 100 characters', async () => {
    const errors = await validate(dto({ teamName: 'x'.repeat(101) }));

    expect(errors.some((error) => error.property === 'teamName')).toBe(true);
  });
});
