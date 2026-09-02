import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(join(__dirname, 'schema.prisma'), 'utf8');
const migration = readFileSync(
  join(
    __dirname,
    'migrations/20260827120000_add_milestone_document_submission_history/migration.sql',
  ),
  'utf8',
);

describe('MilestoneDocumentSubmissionHistory append-only contract', () => {
  it('makes the milestone-level submission type nullable for transition reads', () => {
    const milestone =
      /model Milestone \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? '';
    expect(milestone).toMatch(/submissionType\s+MilestoneSubmissionType\?/);
  });

  it('stores every submission and decision event with actor, revision, time, and immutable file relation', () => {
    expect(schema).toContain('enum MilestoneDocumentSubmissionHistoryEvent');
    expect(schema).toContain('model MilestoneDocumentSubmissionHistory');
    expect(schema).toMatch(/event\s+MilestoneDocumentSubmissionHistoryEvent/);
    expect(schema).toMatch(/revision\s+Int/);
    expect(schema).toMatch(/actorId\s+String/);
    expect(schema).toMatch(/createdAt\s+DateTime/);
    expect(schema).toMatch(
      /submissionHistory\s+MilestoneDocumentSubmissionHistory\?/,
    );
  });

  it('is additive, backfills known current snapshots and legacy reviews, and never deletes production data', () => {
    expect(migration).toContain('ALTER COLUMN "submissionType" DROP NOT NULL');
    expect(migration).toContain(
      'CREATE TABLE "MilestoneDocumentSubmissionHistory"',
    );
    expect(migration).toContain(
      'INSERT INTO "MilestoneDocumentSubmissionHistory"',
    );
    expect(migration).toContain('CONCAT(\'legacy_review_\', MD5(review."id"))');
    expect(migration).toContain('review."decision"::TEXT');
    expect(migration).toContain('BEGIN;');
    expect(migration).toContain('COMMIT;');
    expect(migration).not.toMatch(/DELETE FROM|DROP TABLE/);
  });

  it('여러 ATTACHED 파일 중 현재 revision을 추측하지 않는다', () => {
    expect(migration).toContain('HAVING COUNT(*) > 1');
    expect(migration).toContain("ERRCODE = 'check_violation'");
    expect(migration).toContain(
      'ambiguous milestone document files require row-level reconciliation',
    );
    expect(migration).toContain('"UnambiguousAttachedFile"');
    expect(migration).toContain('HAVING COUNT(*) = 1');
    expect(migration).toContain(
      'file."milestoneDocumentSubmissionId" = unambiguous."milestoneDocumentSubmissionId"',
    );
  });
});
