import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA = readFileSync(join(__dirname, 'schema.prisma'), 'utf8');
const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    'migrations/20260809000000_add_milestone_document_review_history/migration.sql',
  ),
  'utf8',
);

function reviewModelBody(): string {
  const match = /model MilestoneDocumentReviewHistory \{([\s\S]*?)\n\}/.exec(
    SCHEMA,
  );
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('MilestoneDocumentReviewHistory — 판정은 덮어쓰지 않고 쌓인다', () => {
  it('milestoneDocumentSubmissionId에 @unique를 걸지 않는다', () => {
    const body = reviewModelBody();

    const submissionIdLine = body
      .split('\n')
      .find((line) => line.trim().startsWith('milestoneDocumentSubmissionId'));

    expect(submissionIdLine).toBeDefined();
    expect(submissionIdLine).not.toMatch(/@unique/);
  });

  it('모델 어디에도 제출 단위 unique 제약이 없다 — @@unique로도 걸지 않는다', () => {
    const body = reviewModelBody();

    expect(body).not.toMatch(/@@unique/);
    expect(body).not.toMatch(/@unique/);
  });

  it('마이그레이션이 MilestoneDocumentReviewHistory에 UNIQUE 인덱스를 만들지 않는다', () => {
    expect(MIGRATION_SQL).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*"MilestoneDocumentReviewHistory"/i,
    );
  });

  it('최신 한 건 조회를 받치는 (제출, 판정시각) 인덱스를 만든다', () => {
    expect(MIGRATION_SQL).toMatch(
      /CREATE INDEX[^;]*ON "MilestoneDocumentReviewHistory"\("milestoneDocumentSubmissionId", "reviewedAt"\)/,
    );
  });

  it('이름이 History로 끝난다 — 시간 축을 따라 행이 쌓이는 테이블의 이름 규칙', () => {
    expect(SCHEMA).toMatch(/model MilestoneDocumentReviewHistory \{/);
    expect(SCHEMA).not.toMatch(/model MilestoneDocumentReview \{/);
    expect(MIGRATION_SQL).toMatch(
      /CREATE TABLE "MilestoneDocumentReviewHistory"/,
    );
  });
});
