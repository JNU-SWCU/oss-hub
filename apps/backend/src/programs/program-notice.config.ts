export const PROGRAM_NOTICE_WARNINGS = [
  'NO_IMAGE',
  'MULTIPLE_IMAGES',
  'EXTERNAL_APPLICATION_LINK',
] as const;

export type ProgramNoticeWarning = (typeof PROGRAM_NOTICE_WARNINGS)[number];
