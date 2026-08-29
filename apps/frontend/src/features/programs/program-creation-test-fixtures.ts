import {
  createInitialProgramAuthoringState,
  type ProgramAuthoringState,
} from './program-creation-flow';

export function completedAuthoringState(): ProgramAuthoringState {
  const initial = createInitialProgramAuthoringState({
    idempotencyKey: 'request-1',
    milestoneId: 'milestone-1',
  });
  return {
    ...initial,
    currentStep: 'review',
    category: 'OSS_CONTEST',
    name: '합성 OSS 프로그램',
    organizer: '합성 주관기관',
    description: '합성 프로그램 설명',
    applicationStartAt: '2026-09-01T09:00',
    applicationEndAt: '2026-09-01T18:00',
    operationStartAt: '2026-09-02T09:00',
    operationEndAt: '2026-09-30T18:00',
    teamMinSize: '1',
    teamMaxSize: '4',
    milestones: [
      {
        id: 'milestone-1',
        name: '오리엔테이션',
        startAt: '2026-09-02T09:00',
        dueAt: '2026-09-10T18:00',
        instructions: '참여 내용을 확인합니다.',
        requirements: initial.milestones[0]?.requirements ?? [],
      },
    ],
  };
}
