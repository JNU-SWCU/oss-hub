import { describe, expect, it } from 'vitest';
import {
  expectCleanState,
  parseDeadlinePreview,
  toStateCounts,
} from '../../../e2e/support/program-authoring-flow';
import {
  assertAdoptedProgramId,
  programIdFromDetailUrl,
} from '../../../e2e/support/program-authoring-ui';

const CLEAN_COUNTS = {
  programs: 1,
  repositoryJobs: 1,
  repositories: 1,
  dryRunEnvelopes: 1,
  attachedFiles: 2,
  orphanRows: 0,
  orphanObjects: 0,
  milestones: 1,
  documents: 1,
  applications: 1,
  // Application.teamId는 non-null — 개인형 신청도 1인 팀이 붙는다(D5).
  teams: 1,
  notifications: 1,
  mailContentHashes: ['a'.repeat(64)],
  storageContentHashes: ['b'.repeat(64), 'c'.repeat(64)],
} as const;

describe('program authoring E2E fixture state', () => {
  it('accepts exactly the deterministic backend count shape', () => {
    const counts = toStateCounts(CLEAN_COUNTS);

    expect(() => expectCleanState(counts)).not.toThrow();
  });

  it('rejects a state response that has an orphaned object', () => {
    const counts = toStateCounts({ ...CLEAN_COUNTS, orphanObjects: 1 });

    expect(() => expectCleanState(counts)).toThrow(/orphan/);
  });

  it('rejects non-integer backend count fields', () => {
    expect(() => toStateCounts({ ...CLEAN_COUNTS, repositories: 1.5 })).toThrow(
      /repositories/,
    );
  });

  it('parses the bounded deadline preview version used for send', () => {
    expect(
      parseDeadlinePreview({
        previewedAt: '2026-08-20T00:00:00.000Z',
        previewVersion: 'd'.repeat(64),
        applicationCount: 1,
        milestoneCount: 1,
        recipientCount: 1,
        inactiveCount: 0,
        optedOutCount: 0,
        noEmailCount: 0,
      }),
    ).toEqual({
      previewedAt: '2026-08-20T00:00:00.000Z',
      previewVersion: 'd'.repeat(64),
      applicationCount: 1,
      milestoneCount: 1,
      recipientCount: 1,
      inactiveCount: 0,
      optedOutCount: 0,
      noEmailCount: 0,
    });
  });

  it('rejects a control graph that differs from the UI-created program', () => {
    expect(() =>
      assertAdoptedProgramId(
        {
          programId: 'e2e:program-authoring:other',
          milestoneId: 'e2e:program-authoring:milestone',
          documentId: 'e2e:program-authoring:document',
        },
        'e2e:program-authoring:ui-created',
      ),
    ).toThrow(/does not match/);
  });

  it('does not mistake the authoring route for a created Program detail URL', () => {
    expect(programIdFromDetailUrl('http://127.0.0.1/programs/new')).toBeNull();
  });

  it('returns the decoded ID only from an exact Program detail URL', () => {
    expect(
      programIdFromDetailUrl('http://127.0.0.1/programs/generated%3Aprogram'),
    ).toBe('generated:program');
    expect(
      programIdFromDetailUrl(
        'http://127.0.0.1/programs/generated%3Aprogram/edit',
      ),
    ).toBeNull();
  });
});
