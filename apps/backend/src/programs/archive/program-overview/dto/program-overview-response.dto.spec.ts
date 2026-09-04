import { ProgramOverviewResponseDto } from './program-overview-response.dto';

const overviewView = {
  programId: 'cuid-synthetic-program',
  name: 'seed-program-overview-project',
  trackType: 'CURRICULAR',
  lifecycle: 'PUBLISHED',
  milestoneCount: 2,
  boardPostCount: 3,
  participantCount: 188,
  teamCount: 47,
  connectedRepositoryCount: 47,
  nextMilestone: {
    label: 'legacy-next',
    dueAt: new Date('2026-08-10T00:00:00.000Z'),
  },
  remainingMilestones: [
    {
      label: '첫 번째 미래 마감',
      dueAt: new Date('2026-08-10T00:00:00.000Z'),
    },
    {
      label: '두 번째 미래 마감',
      dueAt: new Date('2026-09-01T00:00:00.000Z'),
    },
  ],
  viewer: {
    role: null,
    myDocumentsCompleted: null,
    myDocumentsTotal: null,
    fullySubmittedParticipantCount: null,
    milestoneDocuments: [],
  },
};

describe('ProgramOverviewResponseDto', () => {
  it('remainingMilestones를 ISO 문자열 배열로 직렬화하고 legacy nextMilestone은 내보내지 않는다', () => {
    // Given
    const view = overviewView;

    // When
    const response = ProgramOverviewResponseDto.from(view);

    // Then
    expect(response).toEqual(
      expect.objectContaining({
        remainingMilestones: [
          {
            label: '첫 번째 미래 마감',
            dueAt: '2026-08-10T00:00:00.000Z',
          },
          {
            label: '두 번째 미래 마감',
            dueAt: '2026-09-01T00:00:00.000Z',
          },
        ],
      }),
    );
    expect(response).not.toHaveProperty('nextMilestone');
  });

  it('remainingMilestones에 유효하지 않은 Date가 들어오면 기존 Date 직렬화 예외를 그대로 낸다', () => {
    // Given
    const view = {
      ...overviewView,
      remainingMilestones: [
        {
          label: '유효하지 않은 마감',
          dueAt: new Date('invalid-date'),
        },
      ],
    };

    // When / Then
    expect(() => ProgramOverviewResponseDto.from(view)).toThrow(RangeError);
  });
});
