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
};

const PLAN_DOCUMENT: MilestoneDocumentArchiveDocument = {
  id: 'doc-plan',
  name: '계획서',
  required: false,
};

const TWO_DOCUMENTS = [CONSENT_DOCUMENT, PLAN_DOCUMENT];

function team(
  overrides: Partial<MilestoneDocumentArchiveTeam> = {},
): MilestoneDocumentArchiveTeam {
  return {
    applicationId: 'app-1',
    teamName: '합성팀',
    applicantName: '합성신청자',

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

function unsubmittedRow(
  overrides: Partial<MilestoneDocumentArchiveTeam> = {},
): MilestoneDocumentArchiveManifestRow {
  return {
    team: team(overrides),
    cells: TWO_DOCUMENTS.map((document) => cell(document.id)),
  };
}

function plainLines(csv: string): string[] {
  const body = csv.startsWith(BOM) ? csv.slice(BOM.length) : csv;
  return body.replace(/\r\n$/, '').split(CRLF);
}

function plainFields(csv: string, lineIndex: number): string[] {
  const line = plainLines(csv)[lineIndex];
  if (line === undefined) throw new Error(`${lineIndex}번째 줄이 없다`);
  return line.split(',');
}

describe('milestoneDocumentArchiveManifestCsv', () => {
  describe('Excel 호환', () => {
    it('UTF-8 BOM으로 시작한다 — 없으면 Windows Excel이 한글을 지역 인코딩으로 읽어 깨뜨린다', () => {
      const input = {
        documents: TWO_DOCUMENTS,
        rows: [unsubmittedRow()],
      };

      const csv = milestoneDocumentArchiveManifestCsv(input);

      expect(csv.codePointAt(0)).toBe(0xfeff);
      expect(csv.startsWith(`${BOM}팀,`)).toBe(true);
    });

    it('줄을 CRLF로 끊고 마지막 줄에도 붙인다 — LF만 있으면 옛 Excel이 한 줄로 읽는다', () => {
      const input = {
        documents: TWO_DOCUMENTS,
        rows: [unsubmittedRow(), unsubmittedRow({ teamName: '합성팀2' })],
      };

      const csv = milestoneDocumentArchiveManifestCsv(input);

      expect(csv.endsWith(CRLF)).toBe(true);
      expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
      expect(plainLines(csv)).toHaveLength(3);
    });
  });

  describe('열 구성', () => {
    it('머리글은 팀·신청자·팀원 다음에 서류마다 세 칸을 붙인다', () => {
      const input = { documents: TWO_DOCUMENTS, rows: [] };

      const header = plainFields(milestoneDocumentArchiveManifestCsv(input), 0);

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

      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

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

      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      expect(fields).toHaveLength(9);
      expect(fields.slice(6)).toEqual(['', '', '']);
    });

    it('한 장도 안 낸 팀도 행으로 남는다 — ZIP에는 그 팀 폴더조차 없다', () => {
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

      const csv = milestoneDocumentArchiveManifestCsv(input);

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
      const input = {
        documents: [CONSENT_DOCUMENT],
        rows: [{ team: team(), cells: [cell(CONSENT_DOCUMENT.id, { state })] }],
      };

      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      expect(fields[3]).toBe(label);
    });

    it('제출시각은 서울 시각이다 — UTC 자정 근처면 날짜가 하루 넘어간다', () => {
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

      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      expect(fields[4]).toBe('2026-08-10 00:30');
    });

    it('제출시각은 분까지만 적는다 — 표가 보여 주는 자리와 같다', () => {
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

      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      expect(fields[4]).toBe('2026-08-09 14:30');
      expect(fields[4]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('담기지 않은 첨부는 「ZIP 파일」 칸에 이유를 적는다 — 미제출의 빈 칸과 구별된다', () => {
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

      const csv = milestoneDocumentArchiveManifestCsv(input);

      expect(plainFields(csv, 1).slice(3)).toEqual([
        '승인',
        '2026-08-09 14:30',
        '(첨부를 가져올 수 없음)',
      ]);
      expect(plainFields(csv, 2).slice(3)).toEqual(['미제출', '', '']);
    });

    it('본문을 읽을 수 없는 제출은 「(내용 없음)」으로 적는다', () => {
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

      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      expect(fields[5]).toBe('(내용 없음)');
    });

    it('담긴 경로와 일부 누락 경고를 같은 ZIP 파일 칸에 함께 적는다', () => {
      const input = {
        documents: [PLAN_DOCUMENT],
        rows: [
          {
            team: team(),
            cells: [
              cell(PLAN_DOCUMENT.id, {
                state: 'APPROVED',
                submittedAt: new Date('2026-08-09T05:30:00Z'),
                path: '계획서/합성팀_계획서.pdf · (내용 없음)',
                omission: 'CONTENT_UNAVAILABLE',
              }),
            ],
          },
        ],
      };

      expect(
        plainFields(milestoneDocumentArchiveManifestCsv(input), 1)[5],
      ).toBe('계획서/합성팀_계획서.pdf · (내용 없음)');
    });

    it('통합 제출의 원래 방식을 알 수 없으면 중립적인 누락 사유를 적는다', () => {
      const input = {
        documents: [PLAN_DOCUMENT],
        rows: [
          {
            team: team(),
            cells: [
              cell(PLAN_DOCUMENT.id, {
                state: 'PENDING',
                submittedAt: new Date('2026-08-09T05:30:00Z'),
                omission: 'SUBMISSION_UNAVAILABLE',
              }),
            ],
          },
        ],
      } as const;

      expect(
        plainFields(milestoneDocumentArchiveManifestCsv(input), 1)[5],
      ).toBe('(제출 내용을 가져올 수 없음)');
    });
  });

  describe('값 보호', () => {
    it('쉼표·따옴표·줄바꿈이 있는 값은 따옴표로 감싸고 안쪽 따옴표는 겹친다', () => {
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

      const csv = milestoneDocumentArchiveManifestCsv(input);

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
        const input = {
          documents: [],
          rows: [{ team: team({ teamName }), cells: [] }],
        };

        const csv = milestoneDocumentArchiveManifestCsv(input);

        expect(csv).toContain(`'${teamName}`);
        expect(csv).not.toContain(`${CRLF}${teamName}`);
      },
    );

    it('수식 무력화는 따옴표로 감싸는 것과 무관하다 — 감싸도 Excel은 안쪽을 수식으로 읽는다', () => {
      const input = {
        documents: [],
        rows: [{ team: team({ teamName: '=1,2' }), cells: [] }],
      };

      const csv = milestoneDocumentArchiveManifestCsv(input);

      expect(csv).toContain(`"'=1,2"`);
    });

    it('`-`로 시작하는 평범한 팀 이름도 같은 처리를 받는다', () => {
      const input = {
        documents: [],
        rows: [{ team: team({ teamName: '-팀' }), cells: [] }],
      };

      const csv = milestoneDocumentArchiveManifestCsv(input);

      expect(plainFields(csv, 1)[0]).toBe(`'-팀`);
    });

    it('신청자가 없으면 빈 칸이고, 팀원은 `, `로 잇는다', () => {
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

      const csv = milestoneDocumentArchiveManifestCsv(input);

      expect(csv).toContain(`${CRLF}합성팀,,"합성닉1, 합성닉2"${CRLF}`);
    });

    it('팀원이 없으면 빈 칸이다', () => {
      const input = {
        documents: [],
        rows: [{ team: team({ memberNicknames: [] }), cells: [] }],
      };

      const fields = plainFields(milestoneDocumentArchiveManifestCsv(input), 1);

      expect(fields).toEqual(['합성팀', '합성신청자', '']);
    });
  });
});
