import { createHash } from 'node:crypto';
import { AccountStatus } from '@prisma/client';

export type NotifiableStaffRecipient = {
  readonly id: string;
  readonly notificationEmail: string;
};

export const DEADLINE_LEAD_TIME_MS = 24 * 60 * 60 * 1000;

export type DeadlineWindow = {
  readonly from: Date;
  readonly to: Date;
};

export type DeadlineRecipientSource = {
  readonly id: string;
  readonly nickname: string;
  readonly notificationEmail: string | null;
  readonly notifyEnabled: boolean;
  readonly accountStatus: AccountStatus;
};

export type DeadlineProgramSource = {
  readonly id: string;
  readonly name: string;
  readonly notifyOnDeadline: boolean;
  readonly milestones: readonly {
    readonly id: string;
    readonly name: string;
    readonly dueAt: Date;
    readonly documents: readonly {
      readonly id: string;
      readonly required: boolean;
    }[];
  }[];
  readonly applications: readonly {
    readonly id: string;
    readonly applicant: DeadlineRecipientSource;
    readonly members: readonly DeadlineRecipientSource[];
    readonly submittedDocumentIds: readonly string[];
  }[];
};

export type EligibleDeadlineMilestone = {
  readonly id: string;
  readonly programId: string;
  readonly programName: string;
  readonly milestoneName: string;
  readonly dueAt: Date;
  readonly missingDocumentIds: readonly string[];
};

export type EligibleDeadlineRecipient = {
  readonly id: string;
  readonly nickname: string;
  readonly notificationEmail: string;
  readonly milestones: readonly EligibleDeadlineMilestone[];
};

export type StaffDeadlineMilestone = EligibleDeadlineMilestone & {
  readonly missingNicknames: readonly string[];
};

export type DeadlineEligibilitySummary = {
  readonly applicationCount: number;
  readonly milestoneCount: number;
  readonly recipientCount: number;
  readonly inactiveCount: number;
  readonly optedOutCount: number;
  readonly noEmailCount: number;
};

export type DeadlineEligibility = {
  readonly programId: string;
  readonly enabled: boolean;
  readonly milestones: readonly EligibleDeadlineMilestone[];
  readonly recipients: readonly EligibleDeadlineRecipient[];
  readonly staffMilestones: readonly StaffDeadlineMilestone[];
  readonly applicationCount: number;
  readonly summary: DeadlineEligibilitySummary;
  readonly previewVersion: string;
};

type RecipientAccumulator = {
  readonly source: DeadlineRecipientSource;
  readonly milestones: Map<string, EligibleDeadlineMilestone>;
};

type ExclusionReason = 'inactive' | 'optedOut' | 'noEmail';

const EXCLUSION_SUFFIXES: Record<ExclusionReason, string> = {
  inactive: '비활성',
  optedOut: '수신 거부',
  noEmail: '이메일 없음',
};

type CandidateClassification =
  | { readonly excluded: ExclusionReason }
  | { readonly excluded: null; readonly notificationEmail: string };

function classifyCandidate(
  source: DeadlineRecipientSource,
): CandidateClassification {
  if (source.accountStatus !== AccountStatus.ACTIVE) {
    return { excluded: 'inactive' };
  }
  if (!source.notifyEnabled) return { excluded: 'optedOut' };
  if (source.notificationEmail === null) return { excluded: 'noEmail' };
  return { excluded: null, notificationEmail: source.notificationEmail };
}

function missingNickname(
  source: DeadlineRecipientSource,
  excluded: ExclusionReason | null,
): string {
  return excluded === null
    ? source.nickname
    : `${source.nickname} (${EXCLUSION_SUFFIXES[excluded]})`;
}

export function deadlineWindow(now: Date): DeadlineWindow {
  return {
    from: new Date(now),
    to: new Date(now.getTime() + DEADLINE_LEAD_TIME_MS),
  };
}

export function buildDeadlineEligibility(
  source: DeadlineProgramSource,
  window: DeadlineWindow,
): DeadlineEligibility {
  const milestones = source.milestones
    .flatMap((milestone) => {
      const requiredDocumentIds = milestone.documents
        .filter((document) => document.required)
        .map((document) => document.id)
        .sort();
      return milestone.dueAt >= window.from &&
        milestone.dueAt <= window.to &&
        requiredDocumentIds.length > 0
        ? [
            {
              id: milestone.id,
              programId: source.id,
              programName: source.name,
              milestoneName: milestone.name,
              dueAt: milestone.dueAt,
              missingDocumentIds: requiredDocumentIds,
            },
          ]
        : [];
    })
    .sort(compareMilestones);
  const recipients = new Map<string, RecipientAccumulator>();
  const eligibleApplicationIds: string[] = [];

  for (const application of source.applications) {
    const submitted = new Set(application.submittedDocumentIds);
    const missingMilestones = milestones.flatMap((milestone) => {
      const missingDocumentIds = milestone.missingDocumentIds.filter(
        (documentId) => !submitted.has(documentId),
      );
      return missingDocumentIds.length === 0
        ? []
        : [{ ...milestone, missingDocumentIds }];
    });
    if (missingMilestones.length === 0) continue;
    eligibleApplicationIds.push(application.id);

    const applicationRecipients = new Map(
      [application.applicant, ...application.members].map((recipient) => [
        recipient.id,
        recipient,
      ]),
    );
    for (const recipient of applicationRecipients.values()) {
      const current = recipients.get(recipient.id) ?? {
        source: recipient,
        milestones: new Map<string, EligibleDeadlineMilestone>(),
      };
      for (const milestone of missingMilestones) {
        const existing = current.milestones.get(milestone.id);
        current.milestones.set(
          milestone.id,
          existing === undefined
            ? milestone
            : {
                ...milestone,
                missingDocumentIds: [
                  ...new Set([
                    ...existing.missingDocumentIds,
                    ...milestone.missingDocumentIds,
                  ]),
                ].sort(),
              },
        );
      }
      recipients.set(recipient.id, current);
    }
  }

  const orderedCandidates = [...recipients.values()].sort((left, right) =>
    left.source.id.localeCompare(right.source.id),
  );
  const counts = { inactive: 0, optedOut: 0, noEmail: 0 };
  const deliverableRecipients: EligibleDeadlineRecipient[] = [];
  const missingNicknames = new Map<string, string[]>();
  for (const candidate of orderedCandidates) {
    const classification = classifyCandidate(candidate.source);
    const label = missingNickname(candidate.source, classification.excluded);

    for (const milestoneId of candidate.milestones.keys()) {
      missingNicknames.set(milestoneId, [
        ...(missingNicknames.get(milestoneId) ?? []),
        label,
      ]);
    }
    if (classification.excluded !== null) {
      counts[classification.excluded] += 1;
      continue;
    }
    deliverableRecipients.push({
      id: candidate.source.id,
      nickname: candidate.source.nickname,
      notificationEmail: classification.notificationEmail,
      milestones: [...candidate.milestones.values()].sort(compareMilestones),
    });
  }
  const staffMilestones = milestones.flatMap((milestone) => {
    const missing = missingNicknames.get(milestone.id) ?? [];
    return missing.length === 0
      ? []
      : [{ ...milestone, missingNicknames: missing }];
  });

  const summary = {
    applicationCount: eligibleApplicationIds.length,
    milestoneCount: milestones.length,
    recipientCount: deliverableRecipients.length,
    inactiveCount: counts.inactive,
    optedOutCount: counts.optedOut,
    noEmailCount: counts.noEmail,
  };

  const canonical = {
    programId: source.id,
    enabled: source.notifyOnDeadline,
    milestones: milestones.map(canonicalMilestone),
    applicationIds: eligibleApplicationIds.sort(),
    candidates: orderedCandidates.map((candidate) => ({
      id: candidate.source.id,
      accountStatus: candidate.source.accountStatus,
      notifyEnabled: candidate.source.notifyEnabled,
      notificationEmail: candidate.source.notificationEmail,
      milestones: [...candidate.milestones.values()]
        .sort(compareMilestones)
        .map(canonicalMilestone),
    })),
  };
  return {
    programId: source.id,
    enabled: source.notifyOnDeadline,
    milestones,
    recipients: deliverableRecipients,
    staffMilestones,
    applicationCount: eligibleApplicationIds.length,
    summary,
    previewVersion: createHash('sha256')
      .update(JSON.stringify(canonical))
      .digest('hex'),
  };
}

function compareMilestones(
  left: EligibleDeadlineMilestone,
  right: EligibleDeadlineMilestone,
): number {
  return (
    left.dueAt.getTime() - right.dueAt.getTime() ||
    left.id.localeCompare(right.id)
  );
}

function canonicalMilestone(milestone: EligibleDeadlineMilestone) {
  return {
    id: milestone.id,
    dueAt: milestone.dueAt.toISOString(),
    missingDocumentIds: [...milestone.missingDocumentIds].sort(),
  };
}
