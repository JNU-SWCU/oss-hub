import { UsersService } from '../../src/users/users.service';
import { AdminAccessMutationService } from '../../src/users/admin-access-mutation.service';
import { IndependentAuthorityService } from '../../src/users/independent-authority.service';
import { MemberKindService } from '../../src/users/member-kind.service';
import { AuditLogMetadataService } from '../../src/platform/audit-log-metadata.service';
import { UserProfileService } from '../../src/platform/user-profile.service';
import { BadRequestException, ValidationPipe, type Type } from '@nestjs/common';
import { CreateBoardPostRequestDto } from '../../src/programs/dto/create-board-post-request.dto';
import { UpdateBoardPostRequestDto } from '../../src/programs/dto/update-board-post-request.dto';
import { AdminAccessListRequestDto } from '../../src/admin/dto/admin-access-list-request.dto';
import { PatchAdminAccessRequestDto } from '../../src/admin/dto/patch-admin-access-request.dto';
import { PatchAdminUserProfileRequestDto } from '../../src/admin/dto/patch-admin-user-profile-request.dto';
import { PatchIndependentAuthorityRequestDto } from '../../src/admin/dto/patch-independent-authority-request.dto';
import { PatchMemberKindRequestDto } from '../../src/admin/dto/patch-member-kind-request.dto';
import { CreateMilestoneDocumentSubmissionRequestDto } from '../../src/programs/dto/create-milestone-document-submission-request.dto';
import { CreateProgramDocumentChangeRequestRequestDto } from '../../src/programs/dto/create-program-document-change-request-request.dto';
import {
  CreateResubmissionRequestDto,
  CreateSubmissionRequestDto,
} from '../../src/programs/dto/create-submission-request.dto';
import { ProgramDocumentChangeRequestTargetsRequestDto } from '../../src/programs/dto/program-document-change-request-targets-request.dto';
import { UpdateStudentRepositoryUrlRequestDto } from '../../src/programs/dto/update-student-repository-url-request.dto';
import { RankingRequestDto } from '../../src/ranking/dto/ranking-request.dto';
import {
  AccessRequestsHistoryRequestDto,
  AccessRequestsListRequestDto,
} from '../../src/staff/dto/access-requests-list-request.dto';
import { ActivityTimelineRequestDto } from '../../src/student/dto/activity-timeline-request.dto';
import { UpdateMyProfileRequestDto } from '../../src/users/dto/update-my-profile-request.dto';
import { MilestoneDocumentRulesService } from '../../src/programs/milestone-document-rules.service';
import { SubmissionInputService } from '../../src/programs/submission-input.service';
import { RankingYearService } from '../../src/ranking/ranking-year.service';
import { ProgramRulesService } from '../../src/programs/program-rules.service';
import { useContainer } from 'class-validator';
import { GithubRepositoryUrlConstraintService } from '../../src/programs/github-repository-url-constraint.service';
import { RepositoryUrlService } from '../../src/github/repository-url.service';

const milestoneDocumentRulesService = new MilestoneDocumentRulesService(
  new ProgramRulesService(),
);
const submissionInputService = new SubmissionInputService();
const adminAccessMutationService = new AdminAccessMutationService(
  new AuditLogMetadataService(),
  new UserProfileService(),
);
const independentAuthorityService = Object.create(
  IndependentAuthorityService.prototype,
) as IndependentAuthorityService;
const usersService = Object.create(UsersService.prototype) as UsersService;
const memberKindService = Object.create(
  MemberKindService.prototype,
) as MemberKindService;
const rankingYearService = new RankingYearService();

const pipe = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
const githubRepositoryUrlConstraint = new GithubRepositoryUrlConstraintService(
  new RepositoryUrlService(),
);
useContainer(
  {
    get: (target: unknown) =>
      target === GithubRepositoryUrlConstraintService
        ? githubRepositoryUrlConstraint
        : undefined,
  },
  { fallback: true },
);

const payloads: ReadonlyArray<readonly [string, unknown]> = [
  ['valid', { title: 'Title', body: 'Body' }],
  ['valid at max lengths', { title: 't'.repeat(200), body: 'b'.repeat(10000) }],
  ['empty object', {}],
  ['empty strings', { title: '', body: '' }],
  ['non-string values', { title: 1, body: false }],
  ['null values', { title: null, body: null }],
  ['over max lengths', { title: 't'.repeat(201), body: 'b'.repeat(10001) }],
  ['unknown field', { title: 'Title', body: 'Body', pinned: true }],
];

async function outcome(metatype: Type<unknown>, payload: unknown) {
  try {
    const value: unknown = await pipe.transform(payload, {
      type: 'body',
      metatype,
    });
    return { ok: true, value };
  } catch (error) {
    if (error instanceof BadRequestException) {
      return { ok: false, response: error.getResponse() };
    }
    throw error;
  }
}

describe.each([
  ['CreateBoardPostRequestDto', CreateBoardPostRequestDto],
  ['UpdateBoardPostRequestDto', UpdateBoardPostRequestDto],
] as const)('%s validation parity', (_name, metatype) => {
  it.each(payloads)('%s', async (_case, payload) => {
    expect(JSON.stringify(await outcome(metatype, payload))).toMatchSnapshot();
  });
});

function describeThrown(error: unknown): unknown {
  if (!(error instanceof Error)) throw error;
  const record = error as unknown as Record<string, unknown>;
  return Object.fromEntries(
    ['name', ...Object.getOwnPropertyNames(error)]
      .filter((key) => key !== 'stack')
      .map((key) => [key, record[key]]),
  );
}

type Command<T> = (dto: T) => unknown;

async function parity<T>(
  metatype: Type<T>,
  payload: unknown,
  command: Command<T> | undefined,
): Promise<string> {
  const validated = await outcome(metatype, payload);
  if (!validated.ok || command === undefined) return JSON.stringify(validated);
  try {
    return JSON.stringify({
      ...validated,
      command: command(validated.value as T),
    });
  } catch (error) {
    return JSON.stringify({ ...validated, thrown: describeThrown(error) });
  }
}

function parityCases<T>(
  metatype: Type<T>,
  cases: Readonly<Record<string, unknown>>,
  command?: Command<T>,
): void {
  describe(`${metatype.name} validation parity`, () => {
    it.each(Object.entries(cases))('%s', async (_case, payload) => {
      expect(await parity(metatype, payload, command)).toMatchSnapshot();
    });
  });
}

const FIXED_NOW = new Date('2026-06-15T00:00:00.000Z');
const SORT_QUERY = {
  valid: {
    query: ' kim ',
    role: 'STAFF',
    sort: 'createdAt',
    direction: 'desc',
  },
  empty: {},
  'invalid role': { role: 'nope' },
  'invalid account status': { accountStatus: 'nope' },
  'invalid pending filter': { pendingRequest: 'nope' },
  'invalid sort': { sort: 'nope' },
  'invalid direction': { direction: 'nope' },
  'pending filter value': { pendingRequest: 'PENDING' },
  'page out of range': { page: '0', limit: '101' },
};

parityCases(AdminAccessListRequestDto, SORT_QUERY, (dto) => dto.toQuery());
parityCases(AccessRequestsListRequestDto, SORT_QUERY, (dto) =>
  dto.toRequestQuery(),
);
parityCases(
  AccessRequestsHistoryRequestDto,
  {
    empty: {},
    valid: { staffAccessRequestPage: '2', loginLimit: '5' },
    'out of range': { staffAccessRequestLimit: '101', loginPage: '0' },
  },
  (dto) => dto.toQuery(),
);
const ADMIN_ACCESS_BASE = {
  expectedRole: 'STUDENT',
  desiredRole: 'STAFF',
  expectedAccountStatus: 'ACTIVE',
  desiredAccountStatus: 'ACTIVE',
  expectedPendingRequest: null,
};
parityCases(
  PatchAdminAccessRequestDto,
  {
    valid: ADMIN_ACCESS_BASE,
    'null roles': {
      ...ADMIN_ACCESS_BASE,
      expectedRole: null,
      desiredRole: null,
    },
    'missing fields': {},
    'invalid role': { ...ADMIN_ACCESS_BASE, desiredRole: 'ROOT' },
    'invalid status': { ...ADMIN_ACCESS_BASE, desiredAccountStatus: 'NOPE' },
    'pending not pending': {
      ...ADMIN_ACCESS_BASE,
      expectedPendingRequest: { id: 'r1', status: 'APPROVED' },
    },
    'pending invalid id': {
      ...ADMIN_ACCESS_BASE,
      expectedPendingRequest: { id: 'bad id', status: 'PENDING' },
    },
    approve: {
      ...ADMIN_ACCESS_BASE,
      expectedPendingRequest: { id: 'r1', status: 'PENDING' },
      requestDecision: { decision: 'APPROVE' },
    },
    'reject without reason': {
      ...ADMIN_ACCESS_BASE,
      requestDecision: { decision: 'REJECT', reason: '  ' },
    },
    'reject with reason': {
      ...ADMIN_ACCESS_BASE,
      requestDecision: { decision: 'REJECT', reason: ' why ' },
    },
    'unknown decision': {
      ...ADMIN_ACCESS_BASE,
      requestDecision: { decision: 'NOPE' },
    },
    'partial canonical authority': {
      ...ADMIN_ACCESS_BASE,
      expectedHasStaffAccess: true,
    },
  },
  (dto) => adminAccessMutationService.commandFromPatchAccessRequest(dto),
);
const PROFILE_TEXT = {
  valid: {
    name: ' 홍  길동 ',
    studentId: ' 123456 ',
    department: ' 컴퓨터공학과 ',
  },
  empty: {},
  'blank name': { name: '   ' },
  'long name': { name: 'n'.repeat(201) },
  'non-string name': { name: 1 },
  'bad student id': { studentId: '12345' },
  'blank department': { department: '  ' },
  'long department': { department: 'd'.repeat(201) },
};
parityCases(PatchAdminUserProfileRequestDto, PROFILE_TEXT, (dto) =>
  dto.toCommand(),
);
parityCases(
  PatchIndependentAuthorityRequestDto,
  {
    grant: { command: 'GRANT' },
    revoke: { command: 'REVOKE' },
    unknown: { command: 'NOPE' },
    missing: {},
  },
  (dto) => independentAuthorityService.adminCommandFromRequest(dto),
);
const MEMBER_KIND_BASE = {
  memberKind: 'STAFF',
  expectedMemberKind: 'STUDENT',
  expectedHasStaffAccess: false,
};
parityCases(
  PatchMemberKindRequestDto,
  {
    valid: MEMBER_KIND_BASE,
    'with staff number': { ...MEMBER_KIND_BASE, staffNumber: ' A-1234 ' },
    'digit staff number': { ...MEMBER_KIND_BASE, staffNumber: ' 1234567 ' },
    'null staff number': { ...MEMBER_KIND_BASE, staffNumber: null },
    'blank staff number': { ...MEMBER_KIND_BASE, staffNumber: '  ' },
    'long staff number': { ...MEMBER_KIND_BASE, staffNumber: 's'.repeat(100) },
    'with student fields': {
      ...MEMBER_KIND_BASE,
      memberKind: 'STUDENT',
      studentId: ' 123456 ',
      department: ' 학과 ',
    },
    'bad student id': { ...MEMBER_KIND_BASE, studentId: 'abc' },
    'blank department': { ...MEMBER_KIND_BASE, department: ' ' },
    'unknown member kind': { ...MEMBER_KIND_BASE, memberKind: 'NOPE' },
    'non-boolean access': {
      ...MEMBER_KIND_BASE,
      expectedHasStaffAccess: 'yes',
    },
    missing: {},
  },
  (dto) => memberKindService.commandFromRequest(dto),
);
parityCases(
  UpdateMyProfileRequestDto,
  {
    valid: { name: ' 홍길동 ', department: ' 학과 ' },
    missing: {},
    affiliation: {
      name: '홍길동',
      affiliationKind: 'DEPARTMENT',
      affiliationName: ' 학과 ',
    },
    'unknown affiliation': {
      name: '홍길동',
      affiliationKind: 'NOPE',
      affiliationName: '학과',
    },
    'bad phone': { name: '홍길동', department: '학과', phone: '12' },
    'blank staff number': {
      name: '홍길동',
      department: '학과',
      staffNumber: '  ',
    },
    'bad staff number': {
      name: '홍길동',
      department: '학과',
      staffNumber: 's'.repeat(100),
    },
    'blank name': { name: ' ', department: '학과' },
  },
  (dto) => usersService.profileInputFromRequest(dto),
);
parityCases(ActivityTimelineRequestDto, {
  default: {},
  month: { granularity: 'MONTH' },
  week: { granularity: 'WEEK' },
  invalid: { granularity: 'NOPE' },
});
parityCases(
  RankingRequestDto,
  {
    empty: {},
    all: { year: 'ALL' },
    year: { year: '2024' },
    'pattern miss': { year: '1999' },
    'pattern max': { year: '2100' },
    'period this year': { period: 'THIS_YEAR' },
    'period all': { period: 'ALL' },
    'bad period': { period: 'NOPE' },
    'page out of range': { page: '0', pageSize: '101' },
  },
  (dto) => rankingYearService.resolveRankingQueryYear(dto, FIXED_NOW),
);
parityCases(UpdateStudentRepositoryUrlRequestDto, {
  valid: { repositoryUrl: ' https://github.com/owner/repo ' },
  'wrong host': { repositoryUrl: 'https://gitlab.com/owner/repo' },
  'http scheme': { repositoryUrl: 'http://github.com/owner/repo' },
  'extra segment': { repositoryUrl: 'https://github.com/owner/repo/tree' },
  'not a url': { repositoryUrl: 'nope' },
  'too long': { repositoryUrl: `https://github.com/owner/${'r'.repeat(250)}` },
  'non-string': { repositoryUrl: 1 },
  missing: {},
});
const SUBMISSION_CONTENT = {
  'file content': { type: 'FILE', fileId: ' f1 ' },
  'text content': { type: 'TEXT', text: ' hello ' },
  'blank file': { type: 'FILE', fileId: '  ' },
  'blank text': { type: 'TEXT', text: '  ' },
  'unknown type': { type: 'NOPE' },
  'long text': { type: 'TEXT', text: 't'.repeat(10001) },
};
parityCases(
  CreateSubmissionRequestDto,
  {
    ...Object.fromEntries(
      Object.entries(SUBMISSION_CONTENT).map(([name, content]) => [
        name,
        { applicationId: 'a1', milestoneId: 'm1', content, comment: ' c ' },
      ]),
    ),
    'blank comment': {
      applicationId: 'a1',
      milestoneId: 'm1',
      content: { type: 'TEXT', text: 'x' },
      comment: '  ',
    },
    missing: {},
    'non-object content': {
      applicationId: 'a1',
      milestoneId: 'm1',
      content: 'x',
    },
  },
  (body) => submissionInputService.toCreateSubmissionInput(body),
);
parityCases(
  CreateResubmissionRequestDto,
  {
    ...Object.fromEntries(
      Object.entries(SUBMISSION_CONTENT).map(([name, content]) => [
        name,
        { baseRevision: 1, content },
      ]),
    ),
    'bad revision': { baseRevision: 0, content: { type: 'TEXT', text: 'x' } },
    missing: {},
  },
  (body) => submissionInputService.toResubmitSubmissionInput(body),
);
parityCases(
  CreateMilestoneDocumentSubmissionRequestDto,
  {
    text: { content: { text: ' t ' } },
    file: { content: { fileId: ' f ' } },
    both: { content: { text: ' t ', fileId: ' f ' } },
    blank: { content: { text: ' ', fileId: ' ' } },
    empty: { content: {} },
    missing: {},
    'long file id': { content: { fileId: 'f'.repeat(129) } },
  },
  (dto) =>
    milestoneDocumentRulesService.parseMilestoneDocumentContent(dto.content),
);
const CHANGE_REQUEST_BASE = {
  scope: 'PROGRAM',
  includeFinalDecisions: true,
  comment: ' fix ',
  resubmissionDueAt: '2026-07-01T00:00:00.000Z',
  expectedVersion: 'a'.repeat(64),
};
parityCases(
  CreateProgramDocumentChangeRequestRequestDto,
  {
    program: CHANGE_REQUEST_BASE,
    team: { ...CHANGE_REQUEST_BASE, scope: 'TEAM', teamId: 't1' },
    'team without id': { ...CHANGE_REQUEST_BASE, scope: 'TEAM' },
    'program with team id': { ...CHANGE_REQUEST_BASE, teamId: 't1' },
    'null team id': { ...CHANGE_REQUEST_BASE, teamId: null },
    'blank comment': { ...CHANGE_REQUEST_BASE, comment: '  ' },
    'bad date': { ...CHANGE_REQUEST_BASE, resubmissionDueAt: 'nope' },
    'calendar invalid date': {
      ...CHANGE_REQUEST_BASE,
      resubmissionDueAt: '2026-02-30',
    },
    'bad version': { ...CHANGE_REQUEST_BASE, expectedVersion: 'x' },
    'bad scope': { ...CHANGE_REQUEST_BASE, scope: 'NOPE' },
    missing: {},
  },
  (body) =>
    milestoneDocumentRulesService.toProgramDocumentChangeRequestInput(body),
);
parityCases(
  ProgramDocumentChangeRequestTargetsRequestDto,
  {
    program: { scope: 'PROGRAM' },
    team: { scope: 'TEAM', teamId: 't1' },
    'team without id': { scope: 'TEAM' },
    'program with team id': { scope: 'PROGRAM', teamId: 't1' },
    'bad scope': { scope: 'NOPE' },
    missing: {},
  },
  (dto) =>
    milestoneDocumentRulesService.toProgramDocumentChangeRequestScope(
      dto.scope,
      dto.teamId,
    ),
);
