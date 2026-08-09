import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';
import {
  buildMilestoneDocumentArchivePlan,
  type MilestoneDocumentArchiveDocument,
  type MilestoneDocumentArchiveLayout,
  type MilestoneDocumentArchiveSubmission,
  type MilestoneDocumentArchiveTeam,
} from './milestone-document-archive';

// 합성 데이터만 사용한다 (docs/rules/security.md)
const submittedAt = new Date('2026-08-09T05:00:00.000Z');

function document(
  overrides: Partial<MilestoneDocumentArchiveDocument> = {},
): MilestoneDocumentArchiveDocument {
  return {
    id: 'cuid-synthetic-document',
    name: '사업계획서',
    required: true,
    submissionType: MilestoneSubmissionType.FILE,
    ...overrides,
  };
}

function team(
  overrides: Partial<MilestoneDocumentArchiveTeam> = {},
): MilestoneDocumentArchiveTeam {
  return {
    applicationId: 'cuid-synthetic-application',
    teamName: '코드나무',
    applicantName: '신청자',
    memberNicknames: ['가', '나'],
    ...overrides,
  };
}

function fileSubmission(
  overrides: Partial<MilestoneDocumentArchiveSubmission> = {},
): MilestoneDocumentArchiveSubmission {
  return {
    applicationId: 'cuid-synthetic-application',
    milestoneDocumentId: 'cuid-synthetic-document',
    submittedAt,
    status: SubmissionStatus.SUBMITTED,
    content: null,
    file: {
      storageKey: 'objects/synthetic-a',
      originalFileName: '최종_진짜최종.hwp',
      sizeBytes: 2048,
    },
    ...overrides,
  };
}

function plan(input: {
  documents?: readonly MilestoneDocumentArchiveDocument[];
  teams?: readonly MilestoneDocumentArchiveTeam[];
  submissions?: readonly MilestoneDocumentArchiveSubmission[];
  layout?: MilestoneDocumentArchiveLayout;
}) {
  return buildMilestoneDocumentArchivePlan({
    documents: input.documents ?? [document()],
    teams: input.teams ?? [team()],
    submissions: input.submissions ?? [],
    layout: input.layout ?? 'TEAM',
  });
}

describe('buildMilestoneDocumentArchivePlan', () => {
  it('팀별 묶기는 파일을 `팀명/팀명_서류명.확장자`에 놓는다', () => {
    const result = plan({ submissions: [fileSubmission()] });

    expect(result.entries).toEqual([
      {
        kind: 'STORED_FILE',
        path: '코드나무/코드나무_사업계획서.hwp',
        modifiedAt: submittedAt,
        storageKey: 'objects/synthetic-a',
        sizeBytes: 2048,
      },
    ]);
  });

  it('서류 종류별 묶기는 담는 파일은 그대로 두고 폴더만 뒤집는다', () => {
    const byTeam = plan({ submissions: [fileSubmission()], layout: 'TEAM' });
    const byDocument = plan({
      submissions: [fileSubmission()],
      layout: 'DOCUMENT',
    });

    expect(byDocument.entries[0]?.path).toBe(
      '사업계획서/코드나무_사업계획서.hwp',
    );
    // 경로만 다르고 나머지는 완전히 같아야 한다 — 토글이 담기는 것을 바꾸면 안 된다.
    const withoutPath = (
      entries: ReturnType<typeof plan>['entries'],
    ): unknown[] =>
      entries.map((entry) => {
        const rest: Record<string, unknown> = { ...entry };
        delete rest.path;
        return rest;
      });
    expect(withoutPath(byDocument.entries)).toEqual(
      withoutPath(byTeam.entries),
    );
  });

  it('글 제출은 `.txt` 파일로 담고 본문을 그대로 싣는다', () => {
    const result = plan({
      documents: [document({ submissionType: MilestoneSubmissionType.TEXT })],
      submissions: [
        fileSubmission({
          file: null,
          content: { type: 'TEXT', text: '이번 달에 한 일' },
        }),
      ],
    });

    expect(result.entries).toEqual([
      {
        kind: 'INLINE_TEXT',
        path: '코드나무/코드나무_사업계획서.txt',
        modifiedAt: submittedAt,
        body: '이번 달에 한 일',
      },
    ]);
  });

  it('저장소 릴리스 제출은 URL을 `.txt`로 담는다', () => {
    const result = plan({
      documents: [
        document({
          submissionType: MilestoneSubmissionType.REPOSITORY_RELEASE,
        }),
      ],
      submissions: [
        fileSubmission({
          file: null,
          content: {
            type: 'REPOSITORY_RELEASE',
            releaseUrl: 'https://example.invalid/r/v1',
          },
        }),
      ],
    });

    expect(result.entries[0]).toMatchObject({
      kind: 'INLINE_TEXT',
      body: 'https://example.invalid/r/v1',
    });
  });

  it('한 장도 안 낸 팀은 폴더를 만들지 않지만 현황표에는 미제출로 남는다', () => {
    const result = plan({
      teams: [
        team(),
        team({ applicationId: 'cuid-b', teamName: '오픈테이블' }),
      ],
      submissions: [fileSubmission()],
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.path.startsWith('오픈테이블/')).toBe(false);
    expect(result.manifest).toHaveLength(2);
    expect(result.manifest[1]?.cells[0]).toEqual({
      documentId: 'cuid-synthetic-document',
      state: 'NOT_SUBMITTED',
      submittedAt: null,
      path: null,
      omission: null,
    });
  });

  it('현황표의 칸은 서류(열) 순서를 그대로 따른다', () => {
    const result = plan({
      documents: [
        document({ id: 'doc-a', name: '가서류' }),
        document({ id: 'doc-b', name: '나서류' }),
      ],
      submissions: [fileSubmission({ milestoneDocumentId: 'doc-b' })],
    });

    expect(result.manifest[0]?.cells.map((cell) => cell.documentId)).toEqual([
      'doc-a',
      'doc-b',
    ]);
    expect(result.manifest[0]?.cells[0]?.state).toBe('NOT_SUBMITTED');
    expect(result.manifest[0]?.cells[1]?.state).toBe('PENDING');
  });

  describe('제출 상태 다섯 갈래', () => {
    it.each([
      [SubmissionStatus.SUBMITTED, 'PENDING'],
      [SubmissionStatus.APPROVED, 'APPROVED'],
      [SubmissionStatus.CHANGES_REQUESTED, 'CHANGES_REQUESTED'],
      [SubmissionStatus.REJECTED, 'REJECTED'],
    ])('%s 제출은 %s로 읽는다', (status, expected) => {
      const result = plan({ submissions: [fileSubmission({ status })] });

      expect(result.manifest[0]?.cells[0]?.state).toBe(expected);
    });
  });

  it('첨부가 만료된 파일 제출은 담지 않고 그 이유를 현황표에 남긴다', () => {
    const result = plan({ submissions: [fileSubmission({ file: null })] });

    expect(result.entries).toHaveLength(0);
    expect(result.manifest[0]?.cells[0]).toMatchObject({
      state: 'PENDING',
      submittedAt,
      path: null,
      omission: 'FILE_UNAVAILABLE',
    });
  });

  it('본문을 읽을 수 없는 글 제출도 담지 않고 이유를 남긴다', () => {
    const result = plan({
      documents: [document({ submissionType: MilestoneSubmissionType.TEXT })],
      submissions: [fileSubmission({ file: null, content: { type: 'WAT' } })],
    });

    expect(result.entries).toHaveLength(0);
    expect(result.manifest[0]?.cells[0]?.omission).toBe('CONTENT_UNAVAILABLE');
  });

  describe('이름이 겹칠 때', () => {
    it('같은 이름의 두 팀이 서로를 덮어쓰지 않는다', () => {
      const result = plan({
        teams: [team(), team({ applicationId: 'cuid-b' })],
        submissions: [
          fileSubmission(),
          fileSubmission({ applicationId: 'cuid-b' }),
        ],
      });

      expect(result.entries.map((entry) => entry.path)).toEqual([
        '코드나무/코드나무_사업계획서.hwp',
        '코드나무/코드나무_사업계획서 (2).hwp',
      ]);
    });

    it('세 번째부터도 계속 비켜 간다', () => {
      const result = plan({
        teams: [
          team(),
          team({ applicationId: 'cuid-b' }),
          team({ applicationId: 'cuid-c' }),
        ],
        submissions: [
          fileSubmission(),
          fileSubmission({ applicationId: 'cuid-b' }),
          fileSubmission({ applicationId: 'cuid-c' }),
        ],
      });

      expect(result.entries[2]?.path).toBe(
        '코드나무/코드나무_사업계획서 (3).hwp',
      );
    });

    it('현황표가 가리키는 경로도 비킨 뒤의 경로다', () => {
      const result = plan({
        teams: [team(), team({ applicationId: 'cuid-b' })],
        submissions: [
          fileSubmission(),
          fileSubmission({ applicationId: 'cuid-b' }),
        ],
      });

      // 현황표의 「ZIP 파일」 칸으로 실제 파일을 찾아가야 하므로 원래 이름이 남으면 안 된다.
      expect(result.manifest[1]?.cells[0]?.path).toBe(
        '코드나무/코드나무_사업계획서 (2).hwp',
      );
    });

    it('확장자가 없으면 이름 끝에 붙인다', () => {
      const extensionless = {
        storageKey: 'objects/synthetic-a',
        originalFileName: '첨부',
        sizeBytes: 2048,
      };
      const result = plan({
        teams: [team(), team({ applicationId: 'cuid-b' })],
        submissions: [
          fileSubmission({ file: extensionless }),
          fileSubmission({ applicationId: 'cuid-b', file: extensionless }),
        ],
      });

      expect(result.entries[1]?.path).toBe('코드나무/코드나무_사업계획서 (2)');
    });

    it('대소문자만 다른 팀 이름도 같은 자리로 친다', () => {
      const result = plan({
        teams: [
          team({ teamName: 'Alpha' }),
          team({ applicationId: 'cuid-b', teamName: 'alpha' }),
        ],
        submissions: [
          fileSubmission(),
          fileSubmission({ applicationId: 'cuid-b' }),
        ],
      });

      /*
       * ⚠ 바이트로만 비교하면 두 경로가 「다르다」로 통과하는데, 압축을 푸는 쪽의 파일 시스템은
       * 대체로 대소문자를 안 가린다(Windows·기본 macOS). 그러면 한 팀의 제출물이 조용히 사라진다.
       * 보이는 이름은 학생이 적은 그대로 둔다 — 접는 것은 겹침 판정뿐이다.
       */
      expect(result.entries.map((entry) => entry.path)).toEqual([
        'Alpha/Alpha_사업계획서.hwp',
        'alpha/alpha_사업계획서 (2).hwp',
      ]);
    });

    it('같은 글자를 다른 방식으로 적은 이름도 같은 자리로 친다', () => {
      const composed = '가팀'.normalize('NFC');
      const decomposed = '가팀'.normalize('NFD');
      expect(composed).not.toBe(decomposed); // 바이트는 다르다

      const result = plan({
        teams: [
          team({ teamName: composed }),
          team({ applicationId: 'cuid-b', teamName: decomposed }),
        ],
        submissions: [
          fileSubmission(),
          fileSubmission({ applicationId: 'cuid-b' }),
        ],
      });

      expect(result.entries[1]?.path.endsWith(' (2).hwp')).toBe(true);
    });

    it('팀 이름이 동봉 현황표와 같아도 폴더가 그 자리를 뺏지 않는다', () => {
      const result = plan({
        teams: [team({ teamName: '제출현황.csv' })],
        submissions: [fileSubmission()],
      });

      expect(result.entries[0]?.path).toBe(
        '제출현황.csv (2)/제출현황.csv_사업계획서.hwp',
      );
    });
  });

  describe('Windows에서 풀리지 않는 이름', () => {
    it('예약 장치 이름인 팀은 폴더 이름을 비켜 간다', () => {
      const result = plan({
        teams: [team({ teamName: 'CON' })],
        submissions: [fileSubmission()],
      });

      // `CON` 폴더는 Windows에서 만들어지지 않아 그 팀 것만 통째로 안 풀린다.
      expect(result.entries[0]?.path).toBe('CON_/CON_사업계획서.hwp');
    });

    it('끝에 점이 붙은 이름은 점을 떼고 담는다', () => {
      const result = plan({
        teams: [team({ teamName: '코드나무.' })],
        submissions: [fileSubmission()],
      });

      expect(result.entries[0]?.path).toBe('코드나무/코드나무_사업계획서.hwp');
    });
  });

  it('경로 구분자가 든 팀 이름은 하위 폴더를 만들지 못한다', () => {
    const result = plan({
      teams: [team({ teamName: '../../etc' })],
      submissions: [fileSubmission()],
    });

    expect(result.entries[0]?.path).toBe('.._.._etc/.._.._etc_사업계획서.hwp');
  });

  it('흘려 보낼 바이트 합계는 담은 파일만 센다', () => {
    const result = plan({
      documents: [
        document({ id: 'doc-a' }),
        document({
          id: 'doc-b',
          name: '활동요약',
          submissionType: MilestoneSubmissionType.TEXT,
        }),
      ],
      submissions: [
        fileSubmission({ milestoneDocumentId: 'doc-a' }),
        fileSubmission({
          milestoneDocumentId: 'doc-b',
          file: null,
          content: { type: 'TEXT', text: '글' },
        }),
      ],
    });

    // 글 제출은 스토리지에서 흘려 보내는 것이 아니라 그 자리에서 만든다.
    expect(result.storedBytes).toBe(2048);
    /*
     * ⚠ 글 본문도 **따로 센다**. 크기 상한이 파일만 보면, 글로만 이루어진 마일스톤은 상한이
     * 아예 없는 것과 같다 — 한 건이 10,000자라도 (팀 수 × 서류 수)만큼 쌓이면 수백 MB다.
     */
    expect(result.inlineBytes).toBe(Buffer.byteLength('글', 'utf8'));
  });

  it('승인 목록에 없는 신청의 제출은 담지도 세지도 않는다', () => {
    const result = plan({
      teams: [team()],
      submissions: [
        fileSubmission(),
        // 조회는 서류 id로만 걸러 오므로 승인되지 않은 신청의 제출도 함께 실려 온다.
        fileSubmission({ applicationId: 'cuid-not-approved' }),
      ],
    });

    /*
     * ⚠ **이것이 이 경로의 인가다.** ZIP은 `applicationId`를 입력으로 받지 않고 승인된 신청
     * 목록으로만 칸을 찾으므로, 조회가 남의 제출을 실어 와도 담기지 않는다. 그 보장을 여기서
     * 못 박아 둔다 — 나중에 「조회 결과를 그대로 순회」하도록 고치면 승인 안 된 팀의 제출물이
     * 교직원 ZIP에 섞인다.
     */
    expect(result.entries).toHaveLength(1);
    expect(result.manifest).toHaveLength(1);
    expect(result.storedBytes).toBe(2048);
  });

  it('서류 항목도 팀도 없으면 담을 것이 없다', () => {
    const result = plan({ documents: [], teams: [] });

    expect(result.entries).toHaveLength(0);
    expect(result.manifest).toHaveLength(0);
    expect(result.storedBytes).toBe(0);
  });
});
