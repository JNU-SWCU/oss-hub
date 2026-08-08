import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 서류 제출물의 리비전은 **정수 한 칸이고 비어 있을 수 없다** — 판정 요청이 「교직원이 본 그
 * 제출물인가」를 이 값으로 되묻기 때문이다.
 *
 * 이 불변식 중 일부는 코드가 아니라 스키마만 지킨다. `revision`이 `Int?`로 바뀌면 서비스의
 * 대조는 `null !== number`가 되어 **모든 판정이 409로 막히고**, 서비스·리포지토리 테스트는
 * 그것을 잡지 못한다 — 그쪽 mock은 언제나 숫자를 돌려주기 때문이다. `@default(1)`이 사라지면
 * 새 행의 시작값을 애플리케이션이 정하게 되어 경로마다 갈린다.
 *
 * 같은 폴더의 `milestone-document-review-history.spec.ts`가 판정 이력에 쓰는 방식(스키마 원문과
 * 마이그레이션 SQL을 직접 읽는다)을 그대로 따른다. 판정 이력의 방어와 **파일을 나눈** 이유는
 * 지키는 테이블이 다르기 때문이다 — 그쪽은 `MilestoneDocumentReviewHistory`, 이쪽은
 * `MilestoneDocumentSubmission`이다.
 */
const SCHEMA = readFileSync(join(__dirname, 'schema.prisma'), 'utf8');
const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    'migrations/20260809010000_add_milestone_document_submission_revision/migration.sql',
  ),
  'utf8',
);

/** `model MilestoneDocumentSubmission { … }` 본문만 잘라 낸다 — 다른 모델에 걸리지 않게. */
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
    // Given / When / Then: 이 필드가 없으면 판정은 「지금 있는 행」에 붙는다.
    expect(revisionLine()).toBeDefined();
  });

  it('nullable이 아니다 — Int?면 대조가 언제나 어긋나 모든 판정이 409가 된다', () => {
    // Given / When / Then
    expect(revisionLine()).toMatch(/\brevision\s+Int\b/);
    expect(revisionLine()).not.toMatch(/Int\?/);
  });

  it('@default(1)로 시작값을 스키마가 정한다 — 첫 제출이 1이다', () => {
    // Given / When / Then: 기본값이 없으면 시작값을 코드가 정하게 되어 경로마다 갈리고,
    // upsert의 create 쪽이 값을 들고 있어야만 컴파일된다.
    expect(revisionLine()).toMatch(/@default\(1\)/);
  });

  it('마이그레이션이 NOT NULL + DEFAULT 1로 컬럼을 더한다', () => {
    // Given / When / Then: DB 기본값이 있어야 백필 없이도 기존·신규 행이 1에서 출발한다.
    expect(MIGRATION_SQL).toMatch(
      /ALTER TABLE "MilestoneDocumentSubmission" ADD COLUMN\s+"revision" INTEGER NOT NULL DEFAULT 1;/,
    );
  });

  it('제출 시각은 그대로 남는다 — 리비전이 대신하는 것은 대조이지 표시가 아니다', () => {
    // Given / When / Then: 수합 표는 여전히 "언제 냈는가"를 보여 준다. 함께 지우면 화면이
    // 제출 시점을 잃는다.
    expect(submissionModelBody()).toMatch(/submittedAt\s+DateTime/);
  });
});
