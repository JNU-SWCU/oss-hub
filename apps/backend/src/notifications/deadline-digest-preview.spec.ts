import { AccountStatus } from '@prisma/client';
import {
  buildDeadlineEligibility,
  deadlineWindow,
} from './deadline-digest-eligibility';
import type { DeadlineProgramSource } from './deadline-digest-eligibility';
import { prepareDeadlineDigest } from './deadline-digest-preview';

const now = new Date('2026-08-14T00:00:00Z');
const source: DeadlineProgramSource = {
  id: 'program-1',
  name: 'Synthetic programme',
  notifyOnDeadline: true,
  milestones: [
    {
      id: 'milestone-1',
      name: 'First plan',
      dueAt: new Date('2026-08-14T12:00:00Z'),
      documents: [{ id: 'doc-1', required: true }],
    },
  ],
  applications: [
    {
      id: 'application-1',
      applicant: {
        id: 'student-1',
        nickname: 'synthetic-student',
        notificationEmail: 'student@example.com',
        accountStatus: AccountStatus.ACTIVE,
        notifyEnabled: true,
      },
      members: [],
      submittedDocumentIds: [],
    },
  ],
};
const context = { now, frontendOrigin: new URL('https://oss.example') };
const staff = [{ id: 'staff-1', notificationEmail: 'staff@example.com' }];
const eligibility = buildDeadlineEligibility(source, deadlineWindow(now));

describe('confirmed rendered deadline digest', () => {
  it('changes the confirmation when guidance changes', () => {
    // Given
    const original = prepareDeadlineDigest(eligibility, staff, {
      ...context,
      studentGuidance: 'first',
    });
    // When
    const changed = prepareDeadlineDigest(eligibility, staff, {
      ...context,
      studentGuidance: 'second',
    });
    // Then
    expect(changed.previewVersion).not.toBe(original.previewVersion);
  });

  it('changes the confirmation when staff recipients change', () => {
    // Given
    const original = prepareDeadlineDigest(eligibility, staff, context);
    // When
    const changed = prepareDeadlineDigest(
      eligibility,
      [...staff, { id: 'staff-2', notificationEmail: 'other@example.com' }],
      context,
    );
    // Then
    expect(changed.previewVersion).not.toBe(original.previewVersion);
  });

  it('changes the confirmation when protected programme facts change', () => {
    // Given
    const original = prepareDeadlineDigest(eligibility, staff, context);
    const changedSource = buildDeadlineEligibility(
      { ...source, name: 'Changed programme' },
      deadlineWindow(now),
    );
    // When
    const changed = prepareDeadlineDigest(changedSource, staff, context);
    // Then
    expect(changed.previewVersion).not.toBe(original.previewVersion);
  });

  it('exposes rendered personalized mail without private recipient metadata', () => {
    // Given
    const draft = {
      ...context,
      studentGuidance: 'student note',
      staffGuidance: 'staff note',
    };
    // When
    const prepared = prepareDeadlineDigest(eligibility, staff, draft);
    // Then
    expect(prepared.studentPreviews[0]?.text).toContain(
      source.applications[0]?.applicant.nickname,
    );
    expect(prepared.studentPreviews[0]?.text).toContain('student note');
    expect(prepared.staffPreview?.text).toContain('staff note');
    expect(Object.keys(prepared.studentPreviews[0] ?? {}).sort()).toEqual([
      'displayName',
      'html',
      'subject',
      'text',
    ]);
    expect(JSON.stringify(prepared.studentPreviews)).not.toContain(
      'student@example.com',
    );
  });

  it('produces no mail when no required document is eligible', () => {
    // Given
    const empty = buildDeadlineEligibility(
      { ...source, milestones: [] },
      deadlineWindow(now),
    );
    // When
    const prepared = prepareDeadlineDigest(empty, [], context);
    // Then
    expect(prepared.studentPreviews).toEqual([]);
    expect(prepared.staffPreview).toBeNull();
    expect(prepared.deliveries).toEqual([]);
  });

  it('keeps actionable safe links and identical HTML in each preview and delivery', () => {
    // Given / When
    const prepared = prepareDeadlineDigest(eligibility, staff, context);
    // Then
    expect(prepared.studentPreviews[0]?.html).toContain(
      'href="https://oss.example/programs/program-1#milestone-milestone-1-name" target="_blank" rel="noopener noreferrer"',
    );
    expect(prepared.staffPreview?.html).toContain(
      'href="https://oss.example/dashboard" target="_blank" rel="noopener noreferrer"',
    );
    expect(prepared.deliveries[0]?.mail.html).toBe(
      prepared.studentPreviews[0]?.html,
    );
    expect(prepared.deliveries[1]?.mail.html).toBe(prepared.staffPreview?.html);
  });
});
