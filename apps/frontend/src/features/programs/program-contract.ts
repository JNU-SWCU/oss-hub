export type ViewerRole = 'STUDENT' | 'STAFF' | 'ADMIN' | 'PENDING' | null;

export type ApplicationStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export type SubmissionStatus =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export type ProgramParticipation = 'individual' | 'team';

export const PROGRAM_TRACK_TYPES = ['CURRICULAR', 'EXTRACURRICULAR'] as const;

export type ProgramTrackType = (typeof PROGRAM_TRACK_TYPES)[number];

export const PROGRAM_TRACK_TYPE_LABELS = {
  CURRICULAR: '교과',
  EXTRACURRICULAR: '비교과',
} as const satisfies Record<ProgramTrackType, string>;

export const DEFAULT_PROGRAM_ORGANIZER = '전남대학교 SW중심대학사업단';

export const PROGRAM_ORGANIZER_MAX_COUNT = 10;

export const PROGRAM_ORGANIZER_MAX_LENGTH = 50;

export const PROGRAM_ORGANIZER_MESSAGES = {
  required: '주관기관을 1개 이상 입력해 주세요.',
  tooMany: `주관기관은 ${PROGRAM_ORGANIZER_MAX_COUNT}개까지 입력할 수 있습니다.`,
  tooLong: `주관기관 이름은 ${PROGRAM_ORGANIZER_MAX_LENGTH}자 이하로 입력해 주세요.`,
} as const;

export function programOrganizersError(
  organizers: readonly string[],
): string | undefined {
  const labels = organizers.map((organizer) => organizer.trim());
  if (labels.every((label) => label === ''))
    return PROGRAM_ORGANIZER_MESSAGES.required;
  if (labels.length > PROGRAM_ORGANIZER_MAX_COUNT)
    return PROGRAM_ORGANIZER_MESSAGES.tooMany;
  if (labels.some((label) => label.length > PROGRAM_ORGANIZER_MAX_LENGTH))
    return PROGRAM_ORGANIZER_MESSAGES.tooLong;
  return undefined;
}

export function programOrganizersLabel(organizers: readonly string[]): string {
  return organizers.join(', ');
}
