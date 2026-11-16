export const PROGRAM_ORGANIZERS_MAX_COUNT = 10;
export const PROGRAM_ORGANIZER_MAX_LENGTH = 50;

export const PROGRAM_ORGANIZERS_ERROR_MESSAGES = {
  REQUIRED: '주관기관을 1개 이상 입력해 주세요.',
  TOO_MANY: '주관기관은 10개까지 입력할 수 있습니다.',
  TOO_LONG: '주관기관 이름은 50자 이하로 입력해 주세요.',
} as const;

export type ProgramOrganizersErrorCode =
  keyof typeof PROGRAM_ORGANIZERS_ERROR_MESSAGES;

export type ProgramOrganizersFieldError = {
  readonly field: 'organizers';
  readonly code: ProgramOrganizersErrorCode;
  readonly message: string;
};
