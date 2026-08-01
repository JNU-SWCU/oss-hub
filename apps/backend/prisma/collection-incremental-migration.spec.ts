import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * #414 todo 7 — 증분 수집 schema + Application 공개 예정 필드는 additive-only 계약이다
 * (기존 물리 테이블 무변경, DROP 금지). 이 migration이 실수로 destructive 문을 포함하면
 * 이 테스트가 실패해 additive-only 불변식 회귀를 잡아낸다("destructive-diff 실패 케이스").
 */
const MIGRATION_SQL = readFileSync(
  join(
    __dirname,
    'migrations/20260731150000_add_collection_incremental_schema/migration.sql',
  ),
  'utf8',
);

const DESTRUCTIVE_PATTERNS: readonly RegExp[] = [
  /DROP\s+TABLE/i,
  /DROP\s+COLUMN/i,
  /DROP\s+TYPE/i,
  /DROP\s+CONSTRAINT/i,
  /ALTER\s+COLUMN[^;]*DROP\s+NOT\s+NULL/i,
  /TRUNCATE/i,
];

describe('collection incremental migration — additive-only 계약', () => {
  it.each(DESTRUCTIVE_PATTERNS)(
    'destructive 패턴 %s을(를) 포함하지 않는다',
    (pattern) => {
      expect(MIGRATION_SQL).not.toMatch(pattern);
    },
  );

  it('Application 컬럼 추가는 NOT NULL DEFAULT true로 기존 행을 안전하게 backfill한다', () => {
    expect(MIGRATION_SQL).toMatch(
      /ALTER TABLE "Application" ADD COLUMN\s+"isRepositoryPublicationPlanned" BOOLEAN NOT NULL DEFAULT true/,
    );
  });

  it('신규 테이블만 생성하고 기존 테이블(CanonicalRepository 등)은 건드리지 않는다', () => {
    const createdTables = [
      ...MIGRATION_SQL.matchAll(/CREATE TABLE "(\w+)"/g),
    ].map((match) => match[1]);
    expect(createdTables).toEqual([
      'CollectionRepository',
      'CollectionRepositoryStream',
      'CollectionCommitFact',
      'CollectionPullRequestFact',
      'CollectionReleaseFact',
      'CollectionRepositoryYearAggregate',
      'CollectionContributorYearAggregate',
      'CollectionSyncCursor',
    ]);
  });
});
