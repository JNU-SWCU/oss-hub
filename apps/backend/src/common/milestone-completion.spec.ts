import { MilestoneSubmissionType, SubmissionStatus } from '@prisma/client';
import {
  isMilestoneComplete,
  MILESTONE_NOT_SUBMITTED,
  milestoneCompletionStatus,
  requiredMilestonesApproved,
} from './milestone-completion';

describe('milestoneCompletionStatus — 코드 축만 쓰는 마일스톤', () => {
  it('필수 서류가 없으면 Submission 상태를 그대로 쓴다', () => {
    // Given: 서류 항목이 없는 마일스톤(기존 코드 마일스톤).
    for (const status of [
      SubmissionStatus.SUBMITTED,
      SubmissionStatus.APPROVED,
      SubmissionStatus.CHANGES_REQUESTED,
      SubmissionStatus.REJECTED,
    ]) {
      // When / Then
      expect(
        milestoneCompletionStatus({
          requiredDocumentStatuses: [],
          submissionStatus: status,
        }),
      ).toBe(status);
    }
  });

  it('필수 서류도 Submission 도 없으면 미제출이다 — 아무것도 안 낸 칸이 완료로 새면 안 된다', () => {
    // Given: 서류도 코드도 안 낸 칸.
    const input = {
      requiredDocumentStatuses: [],
      submissionStatus: null,
    } as const;

    // When / Then: 두 축 다 흔적이 없어도 「완료」가 아니다.
    expect(milestoneCompletionStatus(input)).toBe(MILESTONE_NOT_SUBMITTED);
    expect(isMilestoneComplete(input)).toBe(false);
  });
});

describe('milestoneCompletionStatus — 제출 없는 안내용 마일스톤', () => {
  it('상위 제출 방식도 필수 제출 항목도 없으면 미제출이다', () => {
    const input = {
      requiredDocumentStatuses: [],
      submissionStatus: null,
      submissionAxisInUse: false,
    } as const;

    expect(milestoneCompletionStatus(input)).toBe(MILESTONE_NOT_SUBMITTED);
    expect(isMilestoneComplete(input)).toBe(false);
  });
});

describe('requiredMilestonesApproved — 공개 집계의 축 없는 마일스톤', () => {
  it('선택 서류만 있는 마일스톤은 완료할 필수 축이 없으므로 공개를 막지 않는다', () => {
    // 호출자는 선택 서류를 제외하고 필수 서류 축만 넘긴다.
    expect(
      requiredMilestonesApproved(
        [
          {
            id: 'optional-only',
            submissionType: null,
            documents: [],
          },
        ],
        [],
        [],
      ),
    ).toBe(true);
  });

  it('안내용 마일스톤은 공개를 막지 않아도 표시 상태는 fail-closed로 유지한다', () => {
    const input = {
      requiredDocumentStatuses: [],
      submissionStatus: null,
      submissionAxisInUse: false,
    } as const;

    expect(isMilestoneComplete(input)).toBe(false);
    expect(
      requiredMilestonesApproved(
        [{ id: 'informational', submissionType: null, documents: [] }],
        [],
        [],
      ),
    ).toBe(true);
  });

  it('필수 서류 축이 있는 마일스톤은 제출·승인 전까지 공개를 막는다', () => {
    const milestones = [
      {
        id: 'required-document',
        submissionType: null,
        documents: [{ id: 'document-1' }],
      },
    ] as const;

    expect(requiredMilestonesApproved(milestones, [], [])).toBe(false);
    expect(
      requiredMilestonesApproved(
        milestones,
        [],
        [
          {
            milestoneDocumentId: 'document-1',
            status: SubmissionStatus.APPROVED,
          },
        ],
      ),
    ).toBe(true);
  });

  it('레거시 서류-only 마일스톤은 남아 있는 submissionType 때문에 내부 제출을 요구하지 않는다', () => {
    expect(
      requiredMilestonesApproved(
        [
          {
            id: 'legacy-document-only',
            submissionType: MilestoneSubmissionType.TEXT,
            documents: [{ id: 'document-1' }],
          },
        ],
        [],
        [
          {
            milestoneDocumentId: 'document-1',
            status: SubmissionStatus.APPROVED,
          },
        ],
      ),
    ).toBe(true);
  });
});

describe('milestoneCompletionStatus — 서류 축만 쓰는 마일스톤 (#820)', () => {
  it('필수 서류가 전부 승인이고 Submission 이 없으면 완료다', () => {
    // Given: 서류만 받는 마일스톤. 필수 서류 두 건 모두 승인, 코드 제출 행은 없다.
    const input = {
      requiredDocumentStatuses: [
        SubmissionStatus.APPROVED,
        SubmissionStatus.APPROVED,
      ],
      submissionStatus: null,
    } as const;

    // When / Then: 코드 제출을 요구하지 않는다 — #820 이 막혀 있던 지점.
    expect(milestoneCompletionStatus(input)).toBe(SubmissionStatus.APPROVED);
    expect(isMilestoneComplete(input)).toBe(true);
  });

  it('필수 서류 한 건이라도 승인이 아니면 완료가 아니다', () => {
    // Given: 두 건 중 하나만 승인.
    for (const other of [
      SubmissionStatus.SUBMITTED,
      SubmissionStatus.CHANGES_REQUESTED,
      SubmissionStatus.REJECTED,
      null,
    ]) {
      const input = {
        requiredDocumentStatuses: [SubmissionStatus.APPROVED, other],
        submissionStatus: null,
      } as const;

      // When / Then
      expect(isMilestoneComplete(input)).toBe(false);
    }
  });

  it('제출 행이 없는 필수 서류는 미제출로 센다', () => {
    // Given: 필수 서류 두 건 중 하나가 아예 안 들어왔다.
    // When / Then
    expect(
      milestoneCompletionStatus({
        requiredDocumentStatuses: [SubmissionStatus.APPROVED, null],
        submissionStatus: null,
      }),
    ).toBe(MILESTONE_NOT_SUBMITTED);
  });

  it('나쁜 쪽이 이긴다 — 반려가 보완 요청·미제출보다 강하다', () => {
    // Given: 서류 상태가 섞여 있다.
    // When / Then
    expect(
      milestoneCompletionStatus({
        requiredDocumentStatuses: [
          SubmissionStatus.REJECTED,
          SubmissionStatus.CHANGES_REQUESTED,
          null,
        ],
        submissionStatus: null,
      }),
    ).toBe(SubmissionStatus.REJECTED);
    expect(
      milestoneCompletionStatus({
        requiredDocumentStatuses: [SubmissionStatus.CHANGES_REQUESTED, null],
        submissionStatus: null,
      }),
    ).toBe(SubmissionStatus.CHANGES_REQUESTED);
  });
});

describe('milestoneCompletionStatus — 두 축이 다 쓰인 마일스톤', () => {
  it('Submission 행이 있으면 서류가 다 승인이어도 그 행까지 승인이어야 완료다', () => {
    // Given: 필수 서류는 전부 승인인데 코드 제출은 아직 심사 중이다.
    const input = {
      requiredDocumentStatuses: [SubmissionStatus.APPROVED],
      submissionStatus: SubmissionStatus.SUBMITTED,
    } as const;

    // When / Then: 서류만 보고 넓히지 않는다.
    expect(isMilestoneComplete(input)).toBe(false);
    expect(milestoneCompletionStatus(input)).toBe(SubmissionStatus.SUBMITTED);
  });

  it('두 축이 다 승인이어야 완료다', () => {
    // Given / When / Then
    expect(
      isMilestoneComplete({
        requiredDocumentStatuses: [SubmissionStatus.APPROVED],
        submissionStatus: SubmissionStatus.APPROVED,
      }),
    ).toBe(true);
  });

  it('코드 제출이 승인이어도 필수 서류가 안 끝났으면 완료가 아니다', () => {
    // Given: 예전이라면 Submission 만 보고 통과시켰을 칸.
    const input = {
      requiredDocumentStatuses: [null],
      submissionStatus: SubmissionStatus.APPROVED,
    } as const;

    // When / Then: 서류 축이 칸을 잡아 둔다 — 이 방향은 판정을 **좁힌다**.
    expect(isMilestoneComplete(input)).toBe(false);
  });
});

describe('isMilestoneComplete — 공개 자격이 넓어지지 않는다', () => {
  /**
   * ⚠ 저장소 공개는 민감하다. 「완료로 세는 조건」이 넓어진 지점은 **정확히 한 곳**이어야 한다:
   * 필수 서류가 있고 `Submission` 행이 없는 칸. 그 밖의 조합에서 예전보다 참이 더 나오면
   * 공개하면 안 될 저장소가 공개된다.
   */
  const ALL_STATUSES = [
    SubmissionStatus.SUBMITTED,
    SubmissionStatus.APPROVED,
    SubmissionStatus.CHANGES_REQUESTED,
    SubmissionStatus.REJECTED,
    null,
  ] as const;

  it('필수 서류가 없는 칸은 예전 규칙(Submission === APPROVED)과 정확히 같다', () => {
    for (const submissionStatus of ALL_STATUSES) {
      const legacy = submissionStatus === SubmissionStatus.APPROVED;
      expect(
        isMilestoneComplete({
          requiredDocumentStatuses: [],
          submissionStatus,
        }),
      ).toBe(legacy);
    }
  });

  it('Submission 행이 있는 칸은 예전 규칙보다 참이 더 나오지 않는다', () => {
    for (const submissionStatus of ALL_STATUSES) {
      if (submissionStatus === null) continue;
      for (const documentStatus of ALL_STATUSES) {
        const legacy = submissionStatus === SubmissionStatus.APPROVED;
        const now = isMilestoneComplete({
          requiredDocumentStatuses: [documentStatus],
          submissionStatus,
        });
        expect(now && !legacy).toBe(false);
      }
    }
  });
});
