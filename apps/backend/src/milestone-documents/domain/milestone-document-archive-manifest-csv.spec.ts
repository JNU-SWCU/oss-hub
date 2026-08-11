// 합성 데이터만 사용한다 (docs/rules/security.md)
import { MilestoneSubmissionType } from '@prisma/client';
import type {
  MilestoneDocumentArchiveCell,
  MilestoneDocumentArchiveCellState,
  MilestoneDocumentArchiveDocument,
  MilestoneDocumentArchiveManifestRow,
  MilestoneDocumentArchiveTeam,
} from './milestone-document-archive';
import { milestoneDocumentArchiveManifestCsv } from './milestone-document-archive-manifest-csv';

const BOM = '﻿';
const CRLF = '\r\n';

const CONSENT_DOCUMENT: MilestoneDocumentArchiveDocument = {
  id: 'doc-consent',
  name: '동의서',
  required: true,
  submissionType: MilestoneSubmissionType.FILE,
};

const PLAN_DOCUMENT: MilestoneDocumentArchiveDocument = {
  id: 'doc-plan',
  name: '계획서',
  required: false,
  submissionType: MilestoneSubmissionType.TEXT,
};

/** 열 개수를 세기 위한 두 장짜리 구성 — 서류마다 세 칸이 붙는지 여기서 확인한다. */
const TWO_DOCUMENTS = [CONSENT_DOCUMENT, PLAN_DOCUMENT];

function team(
  overrides: Partial<MilestoneDocumentArchiveTeam> = {},
): MilestoneDocumentArchiveTeam {
  return {
    applicationId: 'app-1',
    teamName: '합성팀',
    applicantName: '합성신청자',
    // 기본값에 쉼표를 넣지 않는다 — 이스케이프는 따로 확인하고, 나머지 시험은 칸을 단순히 센다.
    memberNicknames: ['합성닉1'],
    ...overrides,
  };
}

function cell(
  documentId: string,
  overrides: Partial<MilestoneDocumentArchiveCell> = {},
): MilestoneDocumentArchiveCell {
  return {
    documentId,
    state: 'NOT_SUBMITTED',
    submittedAt: null,
    path: null,
    omission: null,
    ...overrides,
  };
}

/** 미제출 한 행 — 모든 서류 칸이 「안 냈다」로 채워진 상태. */
function unsubmittedRow(
  overrides: Partial<MilestoneDocumentArchiveTeam> = {},
): MilestoneDocumentArchiveManifestRow {
  return {
    team: team(overrides),
    cells: TWO_DOCUMENTS.map((document) => cell(document.id)),
  };
}

/**
 * BOM과 마지막 CRLF를 걷어내고 줄로 나눈다.
 *
 * 값 안에 따옴표·쉼표·줄바꿈이 없는 시험에서만 쓴다 — 감싸진 값까지 다루려면 시험 쪽에
 * CSV 파서를 두게 되고, 그러면 시험의 버그와 대상의 버그를 구별할 수 없다.
 */
function plainLines(csv: string): string[] {
  const body = csv.startsWith(BOM) ? csv.slice(BOM.length) : csv;
  return body.replace(/\r\n$/, '').split(CRLF);
}

/** 값에 쉼표가 없는 시험에서 한 줄을 칸으로 나눈다. */
function plainFields(csv: string, lineIndex: number): string[] {
  const line = plainLines(csv)[lineIndex];
  if (line === undefined) throw new Error(`${lineIndex}번째 줄이 없다`);
  return line.split(',');
}

describe('milestoneDocumentArchiveManifestCsv', () => {
  describe('Excel 호환', () => {
    it('UTF-8 BOM으로 시작한다 — 없으면 Windows Excel이 한글을 지역 인코딩으로 읽어 깨뜨린다', () => {
      // Given
      const input = {
        documents: TWO_DOCUMENTS,
        rows: [unsubmittedRow()],
      };

      // When
      const csv = milestoneDocumentArchiveManifestCsv(input);

      // Then: 첫 코드포인트가 U+FEFF여야 한다.
      expect(csv.codePointAt(0)).toBe(0xfeff);
      expect(csv.startsWith(`${BOM}팀,`)).toBe(true);
    });

    it('줄을 CRLF로 끊고 마지막 줄에도 붙인다 — LF만 있으면 옛 Excel이 한 줄로 읽는다', () => {
      // Given
      const input = {
        documents: TWO_DOCUMENTS,
        rows: [unsubmittedRow(), unsubmittedRow({ teamName: '합성팀2' })],
      };

      // When
      const csv = milestoneDocumentArchiveManifestCsv(input);

      // Then: 마지막 줄에도 CRLF가 붙고, 홀로 선 LF는 하나도 없다.
      expect(csv.endsWith(CRLF)).toBe(true);
      expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
      expect(plainLines(csv)).toHaveLength(3);
    });
  });

  describe('열 구성', () => {
    it('머리글은 팀·신청자·팀원 다음에 서류마다 세 칸을 붙인다', () => {
      // Given: 서류 두 장이면 3 + 2 × 3 = 9칸이어야 한다.
      const input = { documents: TWO_DOCUMENTS, rows: [] };

      // When
      const header = plainFields(milestoneDocumentArchiveManifestCsv(input), 0);

      // Then
      expect(header).toEqual([
        '팀',
        '신청자',
        '팀원',
        '동의서 상태',
        '동의서 제출시각',
        '동의서 ZIP 파일',
        '계획서 상태',
        '계획서 제출시각',
        '계획서 ZIP 파일',
      ]);
      expect(header).toHaveLength(9);
    });

    it('열 순서는 documents가 소유한다 — 칸이 뒤섞여 와도 제 서류 열에 앉는다', () => {
      // Given: 행의 cells를 일부러 뒤집어 넣는다(계획서 → 동의서).
      const input = {
        documents: TWO_DOCUMENTS,
        rows: [
          {
            team: team(),
            cells: [
              cell(PLAN_DOCUMENT.id, {
                state: 'APPROVED',
                submittedAt: new Date('2026-08-09T15:30:00Z'),
                path: '계획서/합성팀_계획서.txt',
              }),
              cell(CONSENT_DOCUMENT.id, {
                state: 'REJECTED',
                submittedAt: new Date('2026-08-09T05:30:00Z'),
                path: '동의서/합성팀_동의서.pdf',
              }),
            ],
          },
        ],
      };

      // When
      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      // Then: 앞 세 칸은 동의서(머리글 순서), 뒤 세 칸은 계획서여야 한다.
      expect(fields.slice(3)).toEqual([
        '반려',
        '2026-08-09 14:30',
        '동의서/합성팀_동의서.pdf',
        '승인',
        '2026-08-10 00:30',
        '계획서/합성팀_계획서.txt',
      ]);
    });

    it('행에 없는 서류의 칸은 세 칸을 비우되 열 수는 지킨다', () => {
      // Given: 계획서 칸이 아예 오지 않은 행.
      const input = {
        documents: TWO_DOCUMENTS,
        rows: [
          {
            team: team(),
            cells: [
              cell(CONSENT_DOCUMENT.id, {
                state: 'PENDING',
                submittedAt: new Date('2026-08-09T05:30:00Z'),
                path: '동의서/합성팀_동의서.pdf',
              }),
            ],
          },
        ],
      };

      // When
      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      // Then
      expect(fields).toHaveLength(9);
      expect(fields.slice(6)).toEqual(['', '', '']);
    });

    it('한 장도 안 낸 팀도 행으로 남는다 — ZIP에는 그 팀 폴더조차 없다', () => {
      // Given: 낸 팀 하나, 안 낸 팀 하나.
      const input = {
        documents: TWO_DOCUMENTS,
        rows: [
          {
            team: team({ teamName: '낸팀' }),
            cells: [
              cell(CONSENT_DOCUMENT.id, {
                state: 'APPROVED',
                submittedAt: new Date('2026-08-09T05:30:00Z'),
                path: '동의서/낸팀_동의서.pdf',
              }),
              cell(PLAN_DOCUMENT.id),
            ],
          },
          unsubmittedRow({ teamName: '안낸팀' }),
        ],
      };

      // When
      const csv = milestoneDocumentArchiveManifestCsv(input);

      // Then
      expect(plainLines(csv)).toHaveLength(3);
      expect(plainFields(csv, 2)).toEqual([
        '안낸팀',
        '합성신청자',
        '합성닉1',
        '미제출',
        '',
        '',
        '미제출',
        '',
        '',
      ]);
    });
  });

  describe('칸 표기', () => {
    const stateCases: [MilestoneDocumentArchiveCellState, string][] = [
      ['NOT_SUBMITTED', '미제출'],
      ['PENDING', '검토 대기'],
      ['APPROVED', '승인'],
      ['CHANGES_REQUESTED', '보완 요청'],
      ['REJECTED', '반려'],
    ];

    it.each(stateCases)('%s 칸은 「%s」로 적는다', (state, label) => {
      // Given
      const input = {
        documents: [CONSENT_DOCUMENT],
        rows: [{ team: team(), cells: [cell(CONSENT_DOCUMENT.id, { state })] }],
      };

      // When
      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      // Then
      expect(fields[3]).toBe(label);
    });

    it('제출시각은 서울 시각이다 — UTC 자정 근처면 날짜가 하루 넘어간다', () => {
      // Given: 2026-08-09T15:30Z는 서울에서 이튿날 00:30이다.
      const input = {
        documents: [CONSENT_DOCUMENT],
        rows: [
          {
            team: team(),
            cells: [
              cell(CONSENT_DOCUMENT.id, {
                state: 'PENDING',
                submittedAt: new Date('2026-08-09T15:30:00Z'),
              }),
            ],
          },
        ],
      };

      // When
      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      // Then
      expect(fields[4]).toBe('2026-08-10 00:30');
    });

    it('제출시각은 분까지만 적는다 — 표가 보여 주는 자리와 같다', () => {
      // Given
      const input = {
        documents: [CONSENT_DOCUMENT],
        rows: [
          {
            team: team(),
            cells: [
              cell(CONSENT_DOCUMENT.id, {
                state: 'PENDING',
                submittedAt: new Date('2026-08-09T05:30:00Z'),
              }),
            ],
          },
        ],
      };

      // When
      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      // Then
      expect(fields[4]).toBe('2026-08-09 14:30');
      expect(fields[4]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('담기지 않은 첨부는 「ZIP 파일」 칸에 이유를 적는다 — 미제출의 빈 칸과 구별된다', () => {
      // Given: 승인됐지만 첨부가 사라진 팀과, 아무것도 안 낸 팀.
      const input = {
        documents: [CONSENT_DOCUMENT],
        rows: [
          {
            team: team({ teamName: '만료팀' }),
            cells: [
              cell(CONSENT_DOCUMENT.id, {
                state: 'APPROVED',
                submittedAt: new Date('2026-08-09T05:30:00Z'),
                omission: 'FILE_UNAVAILABLE',
              }),
            ],
          },
          {
            team: team({ teamName: '안낸팀' }),
            cells: [cell(CONSENT_DOCUMENT.id)],
          },
        ],
      };

      // When
      const csv = milestoneDocumentArchiveManifestCsv(input);

      // Then: 상태는 「승인」인데 파일 칸만 사유로 채워진다.
      expect(plainFields(csv, 1).slice(3)).toEqual([
        '승인',
        '2026-08-09 14:30',
        '(첨부를 가져올 수 없음)',
      ]);
      expect(plainFields(csv, 2).slice(3)).toEqual(['미제출', '', '']);
    });

    it('본문을 읽을 수 없는 제출은 「(내용 없음)」으로 적는다', () => {
      // Given
      const input = {
        documents: [PLAN_DOCUMENT],
        rows: [
          {
            team: team(),
            cells: [
              cell(PLAN_DOCUMENT.id, {
                state: 'CHANGES_REQUESTED',
                submittedAt: new Date('2026-08-09T05:30:00Z'),
                omission: 'CONTENT_UNAVAILABLE',
              }),
            ],
          },
        ],
      };

      // When
      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      // Then
      expect(fields[5]).toBe('(내용 없음)');
    });
  });

  describe('값 보호', () => {
    it('쉼표·따옴표·줄바꿈이 있는 값은 따옴표로 감싸고 안쪽 따옴표는 겹친다', () => {
      // Given: 세 가지가 각각 한 칸씩.
      const input = {
        documents: [],
        rows: [
          {
            team: team({
              teamName: '합성"팀',
              applicantName: '합성, 신청자',
              memberNicknames: ['합성\n닉'],
            }),
            cells: [],
          },
        ],
      };

      // When
      const csv = milestoneDocumentArchiveManifestCsv(input);

      // Then
      expect(csv).toContain('"합성""팀","합성, 신청자","합성\n닉"');
    });

    const formulaCases: [string, string][] = [
      ["=cmd|'/c calc'!A1", '외부 명령을 부르는 고전적인 값'],
      ['+1+1', '더하기로 시작하는 값'],
      ['@SUM(A1)', '함수 참조로 시작하는 값'],
      ['\t합성팀', '눈에 보이지 않는 탭'],
      ['\r합성팀', '눈에 보이지 않는 CR'],
    ];

    it.each(formulaCases)(
      '수식으로 시작하는 팀 이름 앞에 작은따옴표를 붙인다 (%#: %s)',
      (teamName) => {
        // Given: 팀 이름은 학생이 정하는 값이라 열린 문이다(CSV injection).
        const input = {
          documents: [],
          rows: [{ team: team({ teamName }), cells: [] }],
        };

        // When
        const csv = milestoneDocumentArchiveManifestCsv(input);

        // Then: 값 바로 앞에 `'`가 있고, 줄 첫머리에 날값이 그대로 서지 않는다.
        expect(csv).toContain(`'${teamName}`);
        expect(csv).not.toContain(`${CRLF}${teamName}`);
      },
    );

    it('수식 무력화는 따옴표로 감싸는 것과 무관하다 — 감싸도 Excel은 안쪽을 수식으로 읽는다', () => {
      // Given: 쉼표까지 들어 있어 어차피 감싸지는 값.
      const input = {
        documents: [],
        rows: [{ team: team({ teamName: '=1,2' }), cells: [] }],
      };

      // When
      const csv = milestoneDocumentArchiveManifestCsv(input);

      // Then: 감싼 따옴표 **안쪽**에 작은따옴표가 먼저 온다.
      expect(csv).toContain(`"'=1,2"`);
    });

    it('`-`로 시작하는 평범한 팀 이름도 같은 처리를 받는다', () => {
      // Given: 공격이 아니라 그냥 이런 이름일 수 있다.
      const input = {
        documents: [],
        rows: [{ team: team({ teamName: '-팀' }), cells: [] }],
      };

      // When
      const csv = milestoneDocumentArchiveManifestCsv(input);

      // Then
      expect(plainFields(csv, 1)[0]).toBe(`'-팀`);
    });

    it('신청자가 없으면 빈 칸이고, 팀원은 `, `로 잇는다', () => {
      // Given
      const input = {
        documents: [],
        rows: [
          {
            team: team({
              applicantName: null,
              memberNicknames: ['합성닉1', '합성닉2'],
            }),
            cells: [],
          },
        ],
      };

      // When
      const csv = milestoneDocumentArchiveManifestCsv(input);

      // Then: 이은 값에 쉼표가 생기므로 그 칸은 따옴표로 감싸진다.
      expect(csv).toContain(`${CRLF}합성팀,,"합성닉1, 합성닉2"${CRLF}`);
    });

    it('팀원이 없으면 빈 칸이다', () => {
      // Given
      const input = {
        documents: [],
        rows: [{ team: team({ memberNicknames: [] }), cells: [] }],
      };

      // When
      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      // Then
      expect(fields).toEqual(['합성팀', '합성신청자', '']);
    });
  });
});
