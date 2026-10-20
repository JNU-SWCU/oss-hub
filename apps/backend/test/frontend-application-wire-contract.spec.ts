import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  serializeCreateApplication,
  serializeTeamManagementQuery,
  TEAM_MANAGEMENT_PAGE_SIZE,
} from '../../frontend/src/features/programs/application-wire';
import { CreateApplicationRequestDto } from '../src/applications/dto/create-application-request.dto';
import { ApplicationListQueryRequestDto } from '../src/applications/dto/application-list-query.dto';

const validation = { whitelist: true, forbidNonWhitelisted: true };

function applicationBody(): Record<string, unknown> {
  const body: unknown = JSON.parse(
    serializeCreateApplication({
      answers: { title: '합성 신청' },
      teamName: '합성 팀',
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: false,
    }),
  );
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('신청 요청은 object여야 합니다.');
  }
  return Object.fromEntries(Object.entries(body));
}

function teamQuery(pageSize = TEAM_MANAGEMENT_PAGE_SIZE) {
  return Object.fromEntries(
    new URLSearchParams(
      serializeTeamManagementQuery({
        page: 2,
        pageSize,
        search: '합성 팀',
        status: 'APPROVED',
      }),
    ),
  );
}

describe('frontend application serializers against backend validation', () => {
  it('accepts the serialized create body without changing its business values', async () => {
    const dto = plainToInstance(CreateApplicationRequestDto, applicationBody());
    expect(await validate(dto, validation)).toEqual([]);
    expect(dto.toInput()).toEqual({
      answers: { title: '합성 신청' },
      teamName: '합성 팀',
      applicationTemplateVersion: 1,
      isRepositoryPublicationPlanned: false,
    });
  });

  it.each(['answers', 'applicationTemplateVersion'])(
    'rejects omission of %s',
    async (field) => {
      const body = applicationBody();
      delete body[field];
      const errors = await validate(
        plainToInstance(CreateApplicationRequestDto, body),
        validation,
      );
      expect(errors.map((error) => error.property)).toContain(field);
    },
  );

  it('rejects an obsolete field added to the actual request', async () => {
    const errors = await validate(
      plainToInstance(CreateApplicationRequestDto, {
        ...applicationBody(),
        members: [],
      }),
      validation,
    );
    expect(errors.map((error) => error.property)).toContain('members');
  });

  it('accepts the actual team screen page size and projection', async () => {
    const dto = plainToInstance(ApplicationListQueryRequestDto, teamQuery());
    expect(await validate(dto, validation)).toEqual([]);
    expect(dto.toQuery()).toEqual({
      page: 2,
      pageSize: TEAM_MANAGEMENT_PAGE_SIZE,
      search: '합성 팀',
      status: 'APPROVED',
      view: 'team-management',
    });
  });

  it.each([0, 101])(
    'rejects invalid page size %s in the serialized query',
    async (pageSize) => {
      const errors = await validate(
        plainToInstance(ApplicationListQueryRequestDto, teamQuery(pageSize)),
        validation,
      );
      expect(errors.map((error) => error.property)).toContain('pageSize');
    },
  );
});
