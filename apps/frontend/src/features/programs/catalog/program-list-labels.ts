import type {
  ProgramListStatus,
  ProgramListSort,
} from './program-list-options';

export const PROGRAM_LIST_STATUS_LABELS = {
  all: '전체',
  recruiting: '모집중',
  in_progress: '진행중',
  upcoming: '예정',
  ended: '종료',
} as const satisfies Readonly<Record<ProgramListStatus, string>>;

export const PROGRAM_LIST_SORT_LABELS = {
  name: '프로그램 이름',
  applicationPeriod: '지원 기간',
  status: '상태',
} as const satisfies Readonly<Record<ProgramListSort, string>>;
