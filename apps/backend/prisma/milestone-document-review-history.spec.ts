import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 서류 제출물 판정은 **쌓여야 한다** — 제출 한 건에 판정이 여러 건 붙는다.
 *
 * 이 불변식은 코드가 아니라 스키마가 지킨다. `MilestoneDocumentReviewHistory.milestoneDocumentSubmissionId`에
 * `@unique`가 붙는 순간 판정은 제출당 한 건이 되고, 재판정이 지난 판정을 덮어쓴다. 그러면
 * 「보완 요청 때 무엇을 지적받았는가」가 사라진다 — 담당 교직원이 바뀌어도 지난 지적이 남아야
 * 한다는 것이 이 기능의 요구다.
 *
 * 서비스·리포지토리 테스트로는 이 회귀를 잡을 수 없다. `create` 문장은 unique가 있든 없든
 * 그대로 컴파일되고 통과하며, 실패는 실제 DB에 두 번째 판정을 쓸 때에야 드러난다. 그래서
 * 스키마 원문과 마이그레이션 SQL을 직접 읽어 고정한다(같은 폴더의
 * `collection-incremental-migration.spec.ts`가 쓰는 방식이다).
 */
const SCHEMA = readFileSync(join(__dirname, 'schema.prisma'), 'utf8');
const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    'migrations/20260809000000_add_milestone_document_review_history/migration.sql',
  ),
  'utf8',
);

/** `model MilestoneDocumentReviewHistory { … }` 본문만 잘라 낸다 — 다른 모델의 @unique에 걸리지 않게. */
function reviewModelBody(): string {
  const match = /model MilestoneDocumentReviewHistory \{([\s\S]*?)\n\}/.exec(
    SCHEMA,
  );
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

describe('MilestoneDocumentReviewHistory — 판정은 덮어쓰지 않고 쌓인다', () => {
  it('milestoneDocumentSubmissionId에 @unique를 걸지 않는다', () => {
    // Given
    const body = reviewModelBody();

    // When
    const submissionIdLine = body
      .split('\n')
      .find((line) => line.trim().startsWith('milestoneDocumentSubmissionId'));

    // Then: unique가 붙으면 재판정이 지난 지적을 덮어쓴다.
    expect(submissionIdLine).toBeDefined();
    expect(submissionIdLine).not.toMatch(/@unique/);
  });

  it('모델 어디에도 제출 단위 unique 제약이 없다 — @@unique로도 걸지 않는다', () => {
    // Given / When
    const body = reviewModelBody();

    // Then
    expect(body).not.toMatch(/@@unique/);
    expect(body).not.toMatch(/@unique/);
  });

  it('마이그레이션이 MilestoneDocumentReviewHistory에 UNIQUE 인덱스를 만들지 않는다', () => {
    // Given / When / Then
    expect(MIGRATION_SQL).not.toMatch(
      /CREATE UNIQUE INDEX[^;]*"MilestoneDocumentReviewHistory"/i,
    );
  });

  it('최신 한 건 조회를 받치는 (제출, 판정시각) 인덱스를 만든다', () => {
    // Given / When / Then: 판정이 쌓이므로 「지금의 판정」은 매번 정렬해서 하나를 골라야 한다.
    expect(MIGRATION_SQL).toMatch(
      /CREATE INDEX[^;]*ON "MilestoneDocumentReviewHistory"\("milestoneDocumentSubmissionId", "reviewedAt"\)/,
    );
  });

  it('이름이 History로 끝난다 — 시간 축을 따라 행이 쌓이는 테이블의 이름 규칙', () => {
    // Given / When / Then: docs/rules/data-modeling.md §4. 이름은 「행이 언제 늘어나는가」에
    // 답해야 한다. `MilestoneDocumentReview`로 되돌리면 upsert 모양(항목당 한 행)인
    // `MilestoneDocumentTemplateFile`과 구분이 사라져, 다음 사람이 판정에 @unique를 걸어도
    // 이름이 말리지 않는다. 스키마와 마이그레이션이 같은 이름을 쓰는지도 함께 본다.
    expect(SCHEMA).toMatch(/model MilestoneDocumentReviewHistory \{/);
    expect(SCHEMA).not.toMatch(/model MilestoneDocumentReview \{/);
    expect(MIGRATION_SQL).toMatch(
      /CREATE TABLE "MilestoneDocumentReviewHistory"/,
    );
  });
});
