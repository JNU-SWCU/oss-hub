import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';
import { Readable } from 'node:stream';
import type { SubmissionFileStoragePort } from '../submissions/submission-file-storage.port';
import { MilestoneDocumentArchiveService } from './milestone-document-archive.service';
import { MilestoneDocumentsErrorCode } from './milestone-documents-error-code.enum';
import type { MilestoneDocumentsRepository } from './milestone-documents.repository';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const syntheticMilestoneId = 'cuid-synthetic-milestone';
const syntheticProgramId = 'cuid-synthetic-program';
const now = new Date('2026-08-09T02:00:00.000Z');
const submittedAt = new Date('2026-08-08T05:00:00.000Z');

const planFileBody = Buffer.from('%PDF-계획서 본문');
const summaryFileBody = Buffer.from('%PDF-요약 본문');

/**
 * ZIP을 **실제로 읽어** 확인하기 위한 최소 파서. 중앙 디렉터리를 훑어 항목마다 이름·UTF-8
 * 플래그·크기·본문을 꺼낸다.
 *
 * 라이브러리(yauzl 등)를 테스트용으로 더 들이지 않는 이유: 우리가 확인하려는 것이 바로
 * 「바이트가 규격대로 나갔는가」라서, 같은 계열 라이브러리로 읽으면 둘이 같은 가정을 공유해
 * 어긋남을 못 본다. 모든 항목이 무압축(`compress: false`)이라 본문은 그대로 잘라 낼 수 있다.
 */
interface ParsedZipEntry {
  readonly name: string;
  readonly isUtf8Flagged: boolean;
  readonly body: Buffer;
}

function parseZip(archive: Buffer): ParsedZipEntry[] {
  const entries: ParsedZipEntry[] = [];
  for (let at = 0; at <= archive.length - 4; at += 1) {
    if (archive.readUInt32LE(at) !== 0x02014b50) continue; // central directory header
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
      // general purpose bit 11 — 이름이 UTF-8임을 압축 해제기에 알리는 비트.
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
        submissionType: MilestoneSubmissionType.FILE,
        templateFileId: null,
      },
      {
        id: 'doc-summary',
        milestoneId: syntheticMilestoneId,
        name: '활동요약',
        required: false,
        sortOrder: 2,
        submissionType: MilestoneSubmissionType.TEXT,
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
      // 스트림을 **다 읽었을 때** 열린 수를 줄인다 — 그래야 `maxOpen`이 「같은 순간에 몇 개가
      // 열려 있었는가」를 말한다(연결이 언제나 하나인지 보려는 값이다).
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
    storage: mocks as unknown as SubmissionFileStoragePort,
  };
}

/**
 * 팀 `teams`개 × 서류 1장짜리 마일스톤. 중앙 디렉터리 크기가 임계를 넘는지 보려는 것이라
 * 파일 본문은 최소로 두고 **경로 길이만** 실제와 비슷하게(한글 팀명) 맞춘다.
 */
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
        submissionType: MilestoneSubmissionType.FILE,
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
    service: new MilestoneDocumentArchiveService(repository, storage),
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
      service.archiveForStaff(syntheticMilestoneId, 'TEAM', now),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.MILESTONE_NOT_FOUND },
    });
  });

  it('첨부 조회에 지금 시각을 그대로 넘겨 만료된 것을 거른다', async () => {
    const { service, repositoryMocks } = buildService();

    const archive = await service.archiveForStaff(
      syntheticMilestoneId,
      'TEAM',
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
      syntheticMilestoneId,
      'TEAM',
      now,
    );
    await collect(archive.body);

    // 2026-08-19T15:00Z = 서울 2026-08-20 00:00 — 날짜가 하루 넘어가는 값이다.
    expect(archive.fileName).toBe('1차 중간 산출물_2026-08-20.zip');
    expect(archive.contentType).toBe('application/zip');
  });

  describe('만들어진 ZIP', () => {
    it('현황표를 맨 앞에 두고 제출물을 팀 폴더에 담는다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        syntheticMilestoneId,
        'TEAM',
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
        syntheticMilestoneId,
        'DOCUMENT',
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
        syntheticMilestoneId,
        'TEAM',
        now,
      );
      const entries = parseZip(await collect(archive.body));

      /*
       * 이 비트가 이 기능에 압축 라이브러리를 들인 이유다. 세우지 않으면 압축 해제기가
       * 이름을 CP437로 읽어 **Windows 탐색기에서만** 한글이 깨진다 — macOS에서 확인하면
       * 멀쩡해 보여서 배포 뒤에야 드러난다.
       */
      expect(entries.every((entry) => entry.isUtf8Flagged)).toBe(true);
    });

    it('스토리지의 파일 본문을 그대로 담는다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        syntheticMilestoneId,
        'TEAM',
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
        syntheticMilestoneId,
        'TEAM',
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
        syntheticMilestoneId,
        'TEAM',
        now,
      );
      const entries = parseZip(await collect(archive.body));
      const manifest = entries
        .find((entry) => entry.name === '제출현황.csv')
        ?.body.toString('utf8');

      expect(manifest?.startsWith('﻿')).toBe(true);
      // 오픈테이블은 활동요약을 안 냈다 — ZIP에는 그 파일이 없지만 현황표에는 남는다.
      expect(manifest).toContain('오픈테이블');
      expect(manifest).toContain('미제출');
    });
  });

  describe('미리 알려 주는 길이', () => {
    it('압축을 시작하기 전에 정확한 바이트 수를 확정한다', async () => {
      const { service } = buildService();

      const archive = await service.archiveForStaff(
        syntheticMilestoneId,
        'TEAM',
        now,
      );
      const bytes = await collect(archive.body);

      /*
       * 정확히 같아야 한다 — 어림값이면 응답의 Content-Length가 본문과 어긋나 브라우저가
       * 멀쩡한 내려받기를 실패로 판정하거나(짧게 말하면) 영영 기다린다(길게 말하면).
       */
      expect(archive.contentLength).toBe(bytes.byteLength);
    });

    /*
     * ⚠ **정상 규모에서 터지던 자리다.** yazl 3.3.1은 크기를 미리 셀 때 중앙 디렉터리가
     * 64KiB를 넘으면 zip64 꼬리표(76바이트)를 더하는데, 실제로 쓸 때는 4GiB를 넘어야 더한다.
     * 그 사이 구간에서는 **미리 말한 길이가 실제보다 정확히 76바이트 크고**, 그러면 응답이
     * 약속한 길이를 못 채워 브라우저가 **매번 「다운로드 실패」로 버린다** — 본문은 멀쩡한
     * ZIP인데 교직원은 몇 번을 눌러도 못 받는다.
     *
     * 한글 경로는 한 항목이 100바이트 안팎이라 팀 100여 개 × 서류 4장이면 닿는다. 그래서
     * 2항목짜리 테스트만으로는 절대 안 보인다 — 임계를 **실제로 넘겨서** 확인한다.
     */
    it.each([
      ['임계 아래', 100],
      ['임계 위', 900],
    ])(
      '%s 항목 수에서도 미리 말한 길이가 실제와 같다',
      async (_label, teams) => {
        const { service } = buildService(manyTeams(teams));

        const archive = await service.archiveForStaff(
          syntheticMilestoneId,
          'TEAM',
          now,
        );
        const bytes = await collect(archive.body);

        expect(archive.contentLength).toBe(bytes.byteLength);
        // 항목이 실제로 다 담겼는지도 함께 본다(현황표 1개 + 팀마다 1개).
        expect(parseZip(bytes)).toHaveLength(teams + 1);
      },
      60_000,
    );

    it('담을 것이 현황표뿐이어도 길이를 안다', async () => {
      const { service } = buildService({
        findSubmissionsForArchive: jest.fn().mockResolvedValue([]),
      });

      const archive = await service.archiveForStaff(
        syntheticMilestoneId,
        'TEAM',
        now,
      );
      const bytes = await collect(archive.body);

      expect(archive.contentLength).toBe(bytes.byteLength);
    });
  });

  it('스토리지 연결을 한 번에 하나만 연다', async () => {
    const { service, storageState, storageMocks } = buildService();

    const archive = await service.archiveForStaff(
      syntheticMilestoneId,
      'TEAM',
      now,
    );
    await collect(archive.body);

    /*
     * 파일 수만큼 한꺼번에 열면 뒤쪽 연결은 자기 차례가 올 때까지 한 바이트도 읽지 않은 채
     * 기다리다 끊긴다. 이 단언이 `addReadStreamLazy`를 쓴 이유를 붙들어 둔다.
     */
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
      service.archiveForStaff(syntheticMilestoneId, 'TEAM', now),
    ).rejects.toMatchObject({
      errorCode: { code: MilestoneDocumentsErrorCode.ARCHIVE_TOO_LARGE },
    });
    // 막았으면 스토리지를 건드리지도 않아야 한다.
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
            // DB가 기억하는 크기와 실제 객체가 어긋난 상태 — 파일이 밖에서 바뀌면 일어난다.
            sizeBytes: planFileBody.byteLength + 10,
          },
        },
      ]),
    });

    const archive = await service.archiveForStaff(
      syntheticMilestoneId,
      'TEAM',
      now,
    );

    /*
     * 길이를 미리 말해 둔 응답이므로 여기서 조용히 끝내면 **약속한 길이보다 짧은 ZIP**이
     * 나간다. 끊어서 실패로 만드는 쪽이 맞다. (그리고 이 오류는 응답이 스트림을 받아 가기
     * 전에 날 수 있어, 듣는 사람이 없으면 프로세스가 죽는다 — 서비스가 그것도 막는다.)
     */
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
      syntheticMilestoneId,
      'TEAM',
      now,
    );
    /*
     * **일부러 읽지 않는다.** 응답이 이 스트림을 받아 가기 전에 오류가 나는 경우를 그대로
     * 재현하는 것이다 — 그때 듣는 사람이 없으면 Node는 스트림의 `error`를 곧바로 throw로
     * 바꾸고 프로세스가 죽는다. 서버 전체가 내려앉는 종류라 「조용히 실패」로 넘길 수 없다.
     */
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
          // 여는 데는 성공하고 **읽다가** 끊긴다 — S3 연결이 죽으면 실제로 이 모양이다.
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
      syntheticMilestoneId,
      'TEAM',
      now,
    );

    /*
     * ⚠ 이 오류는 `zip.on('error')`로 오지 **않는다**. yazl은 넘겨받은 스트림을 `pipe`로만
     * 이어 붙여서 그 스트림의 `error`를 자기 것으로 옮기지 않는다. 잡지 않으면 두 가지가
     * 난다 — 듣는 사람 없는 `error`로 프로세스가 죽거나, 더 흔하게는 **압축이 영원히 끝나지
     * 않아** 교직원의 내려받기가 멈춘 채로 남는다(실측으로 후자를 확인했다).
     * 그래서 이 테스트의 요점은 「오류가 난다」가 아니라 **「끝나기는 한다」**이다.
     */
    await expect(collect(archive.body)).rejects.toThrow(
      'storage connection reset',
    );
  }, 10_000);

  it('응답이 끊기면 남은 파일을 스토리지에서 더 끌어오지 않는다', async () => {
    const { service, storageMocks } = buildService();

    const archive = await service.archiveForStaff(
      syntheticMilestoneId,
      'TEAM',
      now,
    );
    /*
     * 컨트롤러가 `response.on('close')`에서 하는 일과 같다. 이것이 없으면 교직원이 취소해도
     * 서버는 남은 파일을 끝까지 끌어와 스토리지 연결을 붙들고 있는다.
     */
    archive.body.destroy();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    // 취소 시점에 이미 열려 있던 첫 파일 하나까지가 한계다 — 두 번째는 열리지 않는다.
    expect(storageMocks.get.mock.calls.length).toBeLessThan(2);
  });

  it('응답이 끊기면 읽고 있던 스토리지 스트림도 함께 끊는다', async () => {
    // 아무것도 흘려보내지 않는 = 계속 열려 있는 스트림. 실제 S3 응답이 느릴 때의 모양이다.
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
      syntheticMilestoneId,
      'TEAM',
      now,
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(opened).toHaveLength(1);

    archive.body.destroy();
    await new Promise((resolve) => setImmediate(resolve));

    /*
     * ⚠ 여기서 안 끊으면 **S3 커넥션이 영구히 샌다.** 소비자가 사라진 스트림은 역압력에 걸려
     * 그 자리에 멈춘 채 남고 아무도 정리하지 않는다. 스토리지 클라이언트의 소켓 풀은 기본
     * 50개라, 큰 ZIP을 눌렀다 취소하기를 반복하면 풀이 말라 **제출 파일 업·다운로드 전체가
     * 멈춘다.** 마감일에 흔한 동선이라 이론적인 이야기가 아니다.
     */
    expect(opened[0]?.destroyed).toBe(true);
  });

  it('스토리지가 끊기면 내려받기를 오류로 끊는다', async () => {
    const { service } = buildService(
      {},
      { get: jest.fn().mockRejectedValue(new Error('storage down')) },
    );

    const archive = await service.archiveForStaff(
      syntheticMilestoneId,
      'TEAM',
      now,
    );

    /*
     * ⚠ 여기서 스트림을 끊지 않으면 두 가지가 한꺼번에 터진다: yazl이 자기 자신에 emit하는
     * `error`는 듣는 사람이 없으면 Node에서 곧바로 throw이고(프로세스가 죽는다), 죽지 않더라도
     * yazl은 출력 스트림을 끝내지 않아 교직원의 내려받기가 **영원히 끝나지 않는다.**
     */
    await expect(collect(archive.body)).rejects.toThrow('storage down');
  });
});
