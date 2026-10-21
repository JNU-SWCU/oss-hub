export type ViewerRole = 'STUDENT' | 'STAFF' | 'ADMIN' | 'PENDING' | null;

export type ApplicationStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export type SubmissionStatus =
  'NOT_SUBMITTED' | 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'REJECTED';

export type SubmissionType = 'FILE' | 'TEXT';

export type ProgramParticipation = 'individual' | 'team';

export const PROGRAM_TRACK_TYPES = ['CURRICULAR', 'EXTRACURRICULAR'] as const;

export type ProgramTrackType = (typeof PROGRAM_TRACK_TYPES)[number];

export const PROGRAM_TRACK_TYPE_LABELS = {
  CURRICULAR: '교과',
  EXTRACURRICULAR: '비교과',
} as const satisfies Record<ProgramTrackType, string>;
