import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 판정 이력 테이블의 삭제 연쇄와 회차 컬럼은 **스키마 선언이 계약**이다.
 *
 * 이 계약이 깨지는 방식은 조용하다. FK를 `applicationId` 대신 `programId`/`teamId`로도 걸면
 * 팀 하나를 지울 때 그 프로그램의 다른 팀 이력까지 사라지고, 그 사실은 삭제 통합 테스트가
 * 대상 팀만 확인하는 한 드러나지 않는다. `ON DELETE CASCADE`가 `RESTRICT`로 바뀌면 반대로
 * 팀 삭제 자체가 영구히 실패한다. 둘 다 배포 뒤에야 알게 되므로 선언을 직접 읽어 잠근다.
 */
const schema = readFileSync(resolve(__dirname, 'schema.prisma'), 'utf8');
const migration = readFileSync(
  resolve(
    __dirname,
    'migrations/20260920030000_add_application_review_history/migration.sql',
  ),
  'utf8',
);

function modelBlock(source: string, model: string): string {
  const start = source.indexOf(`model ${model} {`);
  assert.notEqual(start, -1, `model ${model} 선언을 찾지 못했다`);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, `model ${model} 블록이 닫히지 않았다`);
  return source.slice(start, end);
}

test('history rows hang off Application alone and cascade on its deletion', () => {
  const block = modelBlock(schema, 'ApplicationReviewHistory');

  assert.match(
    block,
    /application\s+Application\s+@relation\(fields: \[applicationId\], references: \[id\], onDelete: Cascade\)/,
  );
  // 두 번째 cascade 경로가 없다 — 삭제 범위는 Application 하나로만 좁혀진다.
  assert.equal(/programId/.test(block), false);
  assert.equal(/teamId/.test(block), false);
  // actor는 사람이다. 사용자를 지우려 할 때 이력이 조용히 사라지지 않도록 RESTRICT다.
  assert.match(
    block,
    /actor\s+User\s+@relation\(fields: \[actorId\], references: \[id\], onDelete: Restrict\)/,
  );
});

test('history keeps the immutable event shape the review timeline reads', () => {
  const block = modelBlock(schema, 'ApplicationReviewHistory');

  assert.match(block, /eventKind\s+ApplicationReviewEventKind/);
  // 회차는 non-null이다 — 이력 도입 전 사건을 백필하지 않으므로 null이 될 근거가 없다.
  assert.match(block, /revision\s+Int\s*$/m);
  assert.match(block, /rejectionReason\s+String\?/);
  // 최신순 조회가 이 인덱스를 탄다.
  assert.match(block, /@@index\(\[applicationId, occurredAt\]\)/);
});

test('the five review events are exactly the transitions the domain can produce', () => {
  const start = schema.indexOf('enum ApplicationReviewEventKind {');
  assert.notEqual(start, -1);
  const block = schema.slice(start, schema.indexOf('\n}', start));
  const values = block
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  assert.deepEqual(values, [
    'SUBMITTED',
    'RESUBMITTED',
    'APPROVED',
    'REJECTED',
    'REVERTED',
  ]);
});

test('Application carries the submission revision with a backfill-safe default', () => {
  const block = modelBlock(schema, 'Application');

  assert.match(block, /revision\s+Int\s+@default\(1\)/);
  assert.match(block, /reviewHistories\s+ApplicationReviewHistory\[\]/);
});

test('the migration is additive and declares the same cascade as the schema', () => {
  assert.match(
    migration,
    /ALTER TABLE "ApplicationReviewHistory" ADD CONSTRAINT "ApplicationReviewHistory_applicationId_fkey" FOREIGN KEY \("applicationId"\) REFERENCES "Application"\("id"\) ON DELETE CASCADE ON UPDATE CASCADE;/,
  );
  assert.match(
    migration,
    /ALTER TABLE "Application" ADD COLUMN\s+"revision" INTEGER NOT NULL DEFAULT 1;/,
  );
  // 중간 배포 안전성 — 이 마이그레이션은 어떤 컬럼도 지우거나 좁히지 않는다.
  assert.equal(/DROP COLUMN|DROP TABLE|DROP TYPE|SET NOT NULL/.test(migration), false);
});
