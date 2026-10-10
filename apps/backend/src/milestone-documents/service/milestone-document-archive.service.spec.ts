import { SubmissionStatus } from '@prisma/client';
import { Readable } from 'node:stream';
import type { ObjectStoragePort } from '../../storage/domain/object-storage';
import {
  MilestoneDocumentArchiveEntryError,
  MilestoneDocumentArchiveService,
} from './milestone-document-archive.service';
import { MilestoneDocumentsErrorCode } from '../domain/milestone-documents-error-code.enum';
import type { MilestoneDocumentsRepository } from '../repository/milestone-documents.repository';

const syntheticMilestoneId = 'cuid-synthetic-milestone';
const syntheticProgramId = 'cuid-synthetic-program';
const now = new Date('2026-08-09T02:00:00.000Z');
const submittedAt = new Date('2026-08-08T05:00:00.000Z');

const planFileBody = Buffer.from('%PDF-계획서 본문');
const summaryFileBody = Buffer.from('%PDF-요약 본문');

interface ParsedZipEntry {
  readonly name: string;
  readonly isUtf8Flagged: boolean;
  readonly body: Buffer;
}

function parseZip(archive: Buffer): ParsedZipEntry[] {
  const entries: ParsedZipEntry[] = [];
  for (let at = 0; at <= archive.length - 4; at += 1) {
    if (archive.readUInt32LE(at) !== 0x02014b50) continue;
    const flags = archive.readUInt16LE(at + 8);
    const uncompressedSize = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const localHeaderAt = archive.readUInt32LE(at + 42);
    const name = archive
      .subarray(at + 46, at + 46 + nameLength)
      .toString('utf8');

    const localNameLength = archive.readUInt16LE(localHeaderAt + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderAt + 28);
    const bodyAt = localHeaderAt + 30 + localNameLength + localExtraLength;

    entries.push({
      name,

      isUtf8Flagged: (flags & 0x800) !== 0,
      body: archive.subarray(bodyAt, bodyAt + uncompressedSize),
    });
    at += 46 + nameLength + extraLength + commentLength - 1;
  }
  return entries;
}

async function collect(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function archiveFailure(body: Readable): Promise<unknown> {
  return collect(body).then(
    () => {
      throw new Error('압축이 오류 없이 끝났다');
    },
    (reason: unknown) => reason,
  );
}

function buildRepository(overrides: Record<string, jest.Mock> = {}) {
  const mocks = {
    findMilestone: jest.fn().mockResolvedValue({
      id: syntheticMilestoneId,
      programId: syntheticProgramId,
      name: '1차 중간 산출물',
      dueAt: new Date('2026-08-19T15:00:00.000Z'),
    }),
    findByMilestoneId: jest.fn().mockResolvedValue([
      {
        id: 'doc-plan',
        milestoneId: syntheticMilestoneId,
        name: '사업계획서',
        required: true,
        sortOrder: 1,
        templateFileId: null,
      },
      {
        id: 'doc-summary',
        milestoneId: syntheticMilestoneId,
        name: '활동요약',
        required: false,
        sortOrder: 2,
        templateFileId: null,
      },
    ]),
    findApprovedApplicationsForCollection: jest.fn().mockResolvedValue([
      {
        applicationId: 'app-a',
        teamName: '코드나무',
        applicantName: '신청자',
        memberNicknames: ['가', '나'],
      },
      {
        applicationId: 'app-b',
        teamName: '오픈테이블',
        applicantName: null,
        memberNicknames: [],
      },
    ]),
    findSubmissionsForArchive: jest.fn().mockResolvedValue([
      {
        applicationId: 'app-a',
        milestoneDocumentId: 'doc-plan',
        submittedAt,
        status: SubmissionStatus.APPROVED,
        content: null,
        file: {
          storageKey: 'objects/plan',
          originalFileName: '최종_진짜최종.pdf',
          sizeBytes: planFileBody.byteLength,
        },
      },
      {
        applicationId: 'app-a',
        milestoneDocumentId: 'doc-summary',
        submittedAt,
        status: SubmissionStatus.SUBMITTED,
        content: { type: 'TEXT', text: '이번 달에 한 일' },
        file: null,
      },
      {
        applicationId: 'app-b',
        milestoneDocumentId: 'doc-plan',
        submittedAt,
        status: SubmissionStatus.SUBMITTED,
        content: null,
        file: {
          storageKey: 'objects/summary',
          originalFileName: '보고서.pdf',
          sizeBytes: summaryFileBody.byteLength,
        },
      },
    ]),
    ...overrides,
  };
  return {
    mocks,
    repository: mocks as unknown as MilestoneDocumentsRepository,
  };
}

const storedBodies: Readonly<Record<string, Buffer>> = {
  'objects/plan': planFileBody,
  'objects/summary': summaryFileBody,
};

function buildStorage(overrides: Partial<Record<string, jest.Mock>> = {}) {
  const state = { open: 0, maxOpen: 0 };
  const mocks = {
    put: jest.fn(),
    delete: jest.fn(),
    get: jest.fn((objectKey: string) => {
      state.open += 1;
      state.maxOpen = Math.max(state.maxOpen, state.open);
      const body = storedBodies[objectKey] ?? Buffer.alloc(0);

      return Promise.resolve(
        Readable.from(
          (function* stream() {
            yield body;
            state.open -= 1;
          })(),
        ),
      );
    }),
    ...overrides,
  };
  return {
    mocks,
    state,
    storage: mocks as unknown as ObjectStoragePort,
  };
}

function manyTeams(teams: number): Record<string, jest.Mock> {
  const applications = Array.from({ length: teams }, (_unused, index) => ({
    applicationId: `app-${index}`,
    teamName: `합성 참여 팀 ${index}`,
    applicantName: null,
    memberNicknames: [],
  }));
  return {
    findByMilestoneId: jest.fn().mockResolvedValue([
      {
        id: 'doc-plan',
        milestoneId: syntheticMilestoneId,
        name: '사업계획서',
        required: true,
        sortOrder: 1,
        templateFileId: null,
      },
    ]),
    findApprovedApplicationsForCollection: jest
      .fn()
      .mockResolvedValue(applications),
    findSubmissionsForArchive: jest.fn().mockResolvedValue(
      applications.map((application) => ({
        applicationId: application.applicationId,
        milestoneDocumentId: 'doc-plan',
        submittedAt,
        status: SubmissionStatus.SUBMITTED,
        content: null,
        file: {
          storageKey: 'objects/plan',
          originalFileName: '계획서.pdf',
          sizeBytes: planFileBody.byteLength,
        },
      })),
    ),
  };
}

function buildService(
  repositoryOverrides: Record<string, jest.Mock> = {},
  storageOverrides: Partial<Record<string, jest.Mock>> = {},
) {
  const { mocks: repositoryMocks, repository } =
    buildRepository(repositoryOverrides);
  const {
    mocks: storageMocks,
    state,
    storage,
  } = buildStorage(storageOverrides);
  return {
    service: new MilestoneDocumentArchiveService(
      repository,
      storage,
      {
        findProgram: jest.fn(),
        findApprovedTeams: jest.fn(),
      },
      {
        assertActiveStaff: jest
          .fn()
          .mockResolvedValue({ actorId: 'cuid-synthetic-staff' }),
      },
    ),
    repositoryMocks,
    storageMocks,
    storageState: state,
  };
}

describe('MilestoneDocumentArchiveService', () => {
  it('마일스톤이 없으면 404로 막는다', async () => {
    const { service } = buildService({
      findMilestone: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'ALL', grouping: 'TEAM' },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND },
    });
  });

  it('첨부 조회에 지금 시각을 그대로 넘겨 만료된 것을 거른다', async () => {
    const { service, repositoryMocks } = buildService();

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );
    await collect(archive.body);

    expect(repositoryMocks.findSubmissionsForArchive).toHaveBeenCalledWith(
      ['doc-plan', 'doc-summary'],
      now,
    );
  });

  it('내려받는 이름은 마일스톤 이름과 마감일(서울 시각)이다', async () => {
    const { service } = buildService();

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );
    await collect(archive.body);

    expect(archive.fileName).toBe('1차 중간 산출물_2026-08-20.zip');
    expect(archive.contentType).toBe('application/zip');
  });

  describe('만들어진 ZIP', () => {
    it('현황표를 맨 앞에 두고 제출물을 팀 폴더에 담는다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'ALL', grouping: 'TEAM' },
        now,
      );
      const entries = parseZip(await collect(archive.body));

      expect(entries.map((entry) => entry.name)).toEqual([
        '제출현황.csv',
        '코드나무/코드나무_사업계획서.pdf',
        '코드나무/코드나무_활동요약.txt',
        '오픈테이블/오픈테이블_사업계획서.pdf',
      ]);
    });

    it('서류 종류별로 묶으면 폴더만 뒤집힌다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'ALL', grouping: 'DOCUMENT' },
        now,
      );
      const entries = parseZip(await collect(archive.body));

      expect(entries.map((entry) => entry.name)).toEqual([
        '제출현황.csv',
        '사업계획서/코드나무_사업계획서.pdf',
        '활동요약/코드나무_활동요약.txt',
        '사업계획서/오픈테이블_사업계획서.pdf',
      ]);
    });

    it('한글 이름에 UTF-8 플래그를 세운다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'ALL', grouping: 'TEAM' },
        now,
      );
      const entries = parseZip(await collect(archive.body));

      expect(entries.every((entry) => entry.isUtf8Flagged)).toBe(true);
    });

    it('스토리지의 파일 본문을 그대로 담는다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'ALL', grouping: 'TEAM' },
        now,
      );
      const entries = parseZip(await collect(archive.body));

      expect(
        entries.find((entry) => entry.name.endsWith('코드나무_사업계획서.pdf'))
          ?.body,
      ).toEqual(planFileBody);
    });

    it('글 제출은 본문을 그대로 적은 텍스트 파일로 담는다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'ALL', grouping: 'TEAM' },
        now,
      );
      const entries = parseZip(await collect(archive.body));

      expect(
        entries
          .find((entry) => entry.name.endsWith('.txt'))
          ?.body.toString('utf8'),
      ).toBe('이번 달에 한 일');
    });

    it('동봉한 현황표에는 한 장도 안 낸 칸까지 들어간다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'ALL', grouping: 'TEAM' },
        now,
      );
      const entries = parseZip(await collect(archive.body));
      const manifest = entries
        .find((entry) => entry.name === '제출현황.csv')
        ?.body.toString('utf8');

      expect(manifest?.startsWith('﻿')).toBe(true);

      expect(manifest).toContain('오픈테이블');
      expect(manifest).toContain('미제출');
    });
  });

  describe('서류 한 종류만 좁혀 받을 때', () => {
    it('폴더 없이 뿌리에 놓고 그 서류 이름을 파일명에 단다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'DOCUMENT', documentId: 'doc-plan' },
        now,
      );
      const entries = parseZip(await collect(archive.body));

      expect(entries.map((entry) => entry.name)).toEqual([
        '제출현황.csv',
        '코드나무_사업계획서.pdf',
        '오픈테이블_사업계획서.pdf',
      ]);

      expect(archive.fileName).toBe('사업계획서_2026-08-20.zip');
    });

    it('좁힌 서류의 제출만 담고 다른 서류는 조회하지도 않는다', async () => {
      const { service, repositoryMocks } = buildService();

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'DOCUMENT', documentId: 'doc-summary' },
        now,
      );
      const entries = parseZip(await collect(archive.body));

      expect(entries.map((entry) => entry.name)).toEqual([
        '제출현황.csv',
        '코드나무_활동요약.txt',
      ]);

      expect(repositoryMocks.findSubmissionsForArchive).toHaveBeenCalledWith(
        ['doc-summary'],
        now,
      );
    });

    it('동봉 현황표도 그 서류 칸만 담는다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'DOCUMENT', documentId: 'doc-plan' },
        now,
      );
      const entries = parseZip(await collect(archive.body));
      const manifest = entries
        .find((entry) => entry.name === '제출현황.csv')
        ?.body.toString('utf8');

      expect(manifest).toContain('사업계획서 상태');

      expect(manifest).not.toContain('활동요약');

      expect(manifest).toContain('오픈테이블');
    });

    it('이 마일스톤에 없는 서류 id 면 빈 ZIP 이 아니라 404 다', async () => {
      const { service, storageMocks } = buildService();

      await expect(
        service.archiveForStaff(
          1n,
          syntheticMilestoneId,
          { kind: 'DOCUMENT', documentId: 'doc-of-another-milestone' },
          now,
        ),
      ).rejects.toMatchObject({
        errorCode: { code: MilestoneDocumentsErrorCode.DOCUMENT_NOT_FOUND },
      });

      expect(storageMocks.get).not.toHaveBeenCalled();
    });
  });

  describe('미리 알려 주는 길이', () => {
    it('압축을 시작하기 전에 정확한 바이트 수를 확정한다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'ALL', grouping: 'TEAM' },
        now,
      );
      const bytes = await collect(archive.body);

      expect(archive.contentLength).toBe(bytes.byteLength);
    });

    it.each([
      ['임계 아래', 100],
      ['임계 위', 900],
    ])(
      '%s 항목 수에서도 미리 말한 길이가 실제와 같다',
      async (_label, teams) => {
        const { service } = buildService(manyTeams(teams));

        const archive = await service.archiveForStaff(
          1n,
          syntheticMilestoneId,
          { kind: 'ALL', grouping: 'TEAM' },
          now,
        );
        const bytes = await collect(archive.body);

        expect(archive.contentLength).toBe(bytes.byteLength);

        expect(parseZip(bytes)).toHaveLength(teams + 1);
      },
      60_000,
    );

    it('담을 것이 현황표뿐이어도 길이를 안다', async () => {
      const { service } = buildService({
        findSubmissionsForArchive: jest.fn().mockResolvedValue([]),
      });

      const archive = await service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'ALL', grouping: 'TEAM' },
        now,
      );
      const bytes = await collect(archive.body);

      expect(archive.contentLength).toBe(bytes.byteLength);
    });
  });

  it('스토리지 연결을 한 번에 하나만 연다', async () => {
    const { service, storageState, storageMocks } = buildService();

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );
    await collect(archive.body);

    expect(storageMocks.get).toHaveBeenCalledTimes(2);
    expect(storageState.maxOpen).toBe(1);
  });

  it('담을 파일이 상한을 넘으면 압축을 시작하지 않고 413으로 막는다', async () => {
    const { service, storageMocks } = buildService({
      findSubmissionsForArchive: jest.fn().mockResolvedValue([
        {
          applicationId: 'app-a',
          milestoneDocumentId: 'doc-plan',
          submittedAt,
          status: SubmissionStatus.SUBMITTED,
          content: null,
          file: {
            storageKey: 'objects/plan',
            originalFileName: '큰파일.pdf',
            sizeBytes: 3 * 1024 * 1024 * 1024,
          },
        },
      ]),
    });

    await expect(
      service.archiveForStaff(
        1n,
        syntheticMilestoneId,
        { kind: 'ALL', grouping: 'TEAM' },
        now,
      ),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.ARCHIVE_TOO_LARGE },
    });

    expect(storageMocks.get).not.toHaveBeenCalled();
  });

  it('스토리지의 파일이 기록된 크기와 다르면 잘린 ZIP을 내보내지 않고 끊는다', async () => {
    const { service } = buildService({
      findSubmissionsForArchive: jest.fn().mockResolvedValue([
        {
          applicationId: 'app-a',
          milestoneDocumentId: 'doc-plan',
          submittedAt,
          status: SubmissionStatus.SUBMITTED,
          content: null,
          file: {
            storageKey: 'objects/plan',
            originalFileName: '계획서.pdf',

            sizeBytes: planFileBody.byteLength + 10,
          },
        },
      ]),
    });

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );

    await expect(collect(archive.body)).rejects.toThrow(
      'unexpected number of bytes',
    );
  });

  it('아무도 읽으러 오기 전에 난 오류가 프로세스를 죽이지 않는다', async () => {
    const { service } = buildService({
      findSubmissionsForArchive: jest.fn().mockResolvedValue([
        {
          applicationId: 'app-a',
          milestoneDocumentId: 'doc-plan',
          submittedAt,
          status: SubmissionStatus.SUBMITTED,
          content: null,
          file: {
            storageKey: 'objects/plan',
            originalFileName: '계획서.pdf',
            sizeBytes: planFileBody.byteLength + 10,
          },
        },
      ]),
    });

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(archive.body.destroyed).toBe(true);
    expect(archive.body.errored).toBeInstanceOf(Error);
  });

  it('스토리지 스트림이 읽는 중에 끊겨도 압축이 멈춰 서지 않는다', async () => {
    const { service } = buildService(
      {},
      {
        get: jest.fn(() => {
          let sent = false;
          return Promise.resolve(
            new Readable({
              read() {
                if (sent) return;
                sent = true;
                this.push(planFileBody.subarray(0, 3));
                setImmediate(() =>
                  this.destroy(new Error('storage connection reset')),
                );
              },
            }),
          );
        }),
      },
    );

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );

    await expect(collect(archive.body)).rejects.toThrow(
      'storage connection reset',
    );
  }, 10_000);

  it('응답이 끊기면 남은 파일을 스토리지에서 더 끌어오지 않는다', async () => {
    const { service, storageMocks } = buildService();

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );

    archive.body.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(storageMocks.get.mock.calls.length).toBeLessThan(2);
  });

  it('응답이 끊기면 읽고 있던 스토리지 스트림도 함께 끊는다', async () => {
    const opened: Readable[] = [];
    const { service } = buildService(
      {},
      {
        get: jest.fn(() => {
          const body = new Readable({ read() {} });
          opened.push(body);
          return Promise.resolve(body);
        }),
      },
    );

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(opened).toHaveLength(1);

    archive.body.destroy();
    await new Promise((resolve) => setImmediate(resolve));

    expect(opened[0]?.destroyed).toBe(true);
  });

  it('스토리지가 늦게 응답하는 사이에 끊겨도 그 스트림을 붙들지 않는다', async () => {
    const opened: Readable[] = [];
    let resolveGet!: (body: Readable) => void;
    const pendingGet = new Promise<Readable>((resolve) => {
      resolveGet = resolve;
    });
    const { service } = buildService({}, { get: jest.fn(() => pendingGet) });

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );
    await new Promise((resolve) => setImmediate(resolve));

    archive.body.destroy();
    await new Promise((resolve) => setImmediate(resolve));

    const late = new Readable({ read() {} });
    opened.push(late);
    resolveGet(late);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(opened[0]?.destroyed).toBe(true);
  });

  it('스토리지가 끊기면 내려받기를 오류로 끊는다', async () => {
    const { service } = buildService(
      {},
      { get: jest.fn().mockRejectedValue(new Error('storage down')) },
    );

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );

    await expect(collect(archive.body)).rejects.toThrow('storage down');
  });

  it('여는 데 실패하면 어느 항목이었는지를 오류가 지고 올라간다', async () => {
    const { service } = buildService(
      {},
      { get: jest.fn().mockRejectedValue(new Error('storage down')) },
    );

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );

    const failure = await archiveFailure(archive.body);

    expect(failure).toBeInstanceOf(MilestoneDocumentArchiveEntryError);
    expect((failure as MilestoneDocumentArchiveEntryError).storageKey).toBe(
      'objects/plan',
    );

    expect((failure as Error).message).toBe('storage down');
  });

  it('항목을 지목하는 값에 팀 이름·학생이 올린 파일명을 담지 않는다', async () => {
    const { service } = buildService(
      {},
      { get: jest.fn().mockRejectedValue(new Error('storage down')) },
    );

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );

    const failure = await archiveFailure(archive.body);

    const failureText = `${(failure as Error).message} ${
      (failure as MilestoneDocumentArchiveEntryError).storageKey
    }`;
    expect(failureText).not.toContain('코드나무');
    expect(failureText).not.toContain('최종_진짜최종.pdf');
    expect(failureText).not.toContain('사업계획서');
  });

  it('열어 놓고 읽는 중에 끊겨도 어느 항목이었는지를 오류가 지고 올라간다', async () => {
    const { service } = buildService(
      {},
      {
        get: jest.fn(() => {
          let sent = false;
          return Promise.resolve(
            new Readable({
              read() {
                if (sent) return;
                sent = true;
                this.push(planFileBody.subarray(0, 3));
                setImmediate(() =>
                  this.destroy(new Error('storage connection reset')),
                );
              },
            }),
          );
        }),
      },
    );

    const archive = await service.archiveForStaff(
      1n,
      syntheticMilestoneId,
      { kind: 'ALL', grouping: 'TEAM' },
      now,
    );

    const failure = await archiveFailure(archive.body);

    expect(failure).toBeInstanceOf(MilestoneDocumentArchiveEntryError);
    expect((failure as MilestoneDocumentArchiveEntryError).storageKey).toBe(
      'objects/plan',
    );
    expect((failure as Error).message).toBe('storage connection reset');
  }, 10_000);
});
