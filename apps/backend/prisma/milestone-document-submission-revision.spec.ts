import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = readFileSync(join(__dirname, 'schema.prisma'), 'utf8');
const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    'migrations/20260809010000_add_milestone_document_submission_revision/migration.sql',
  ),
  'utf8',
);

function submissionModelBody(): string {
  const match = /model MilestoneDocumentSubmission \{([\s\S]*?)\n\}/.exec(
    SCHEMA,
  );
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

function revisionLine(): string | undefined {
  return submissionModelBody()
    .split('\n')
    .find((line) => line.trim().startsWith('revision '));
}

describe('MilestoneDocumentSubmission.revision — 판정을 본 그 제출물에 묶는 축', () => {
  it('제출 모델에 revision 필드가 있다', () => {
    expect(revisionLine()).toBeDefined();
  });

  it('nullable이 아니다 — Int?면 대조가 언제나 어긋나 모든 판정이 409가 된다', () => {
    expect(revisionLine()).toMatch(/\brevision\s+Int\b/);
    expect(revisionLine()).not.toMatch(/Int\?/);
  });

  it('@default(1)로 시작값을 스키마가 정한다 — 첫 제출이 1이다', () => {
    expect(revisionLine()).toMatch(/@default\(1\)/);
  });

  it('마이그레이션이 NOT NULL + DEFAULT 1로 컬럼을 더한다', () => {
    expect(MIGRATION_SQL).toMatch(
      /ALTER TABLE "MilestoneDocumentSubmission" ADD COLUMN\s+"revision" INTEGER NOT NULL DEFAULT 1;/,
    );
  });

  it('제출 시각은 그대로 남는다 — 리비전이 대신하는 것은 대조이지 표시가 아니다', () => {
    expect(submissionModelBody()).toMatch(/submittedAt\s+DateTime/);
  });
});
