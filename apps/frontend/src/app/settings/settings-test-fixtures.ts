export const SETTINGS_SAVED_PROFILE = {
  githubLogin: 'synthetic-staff',
  memberKind: 'STAFF',
  name: '김교직',
  studentId: null,
  staffNumber: null,
  department: '컴퓨터정보통신공학과',
  phone: null,
  isComplete: true,
  participations: [],
} as const;

export const SETTINGS_SAVED_STUDENT_PROFILE = {
  githubLogin: 'synthetic-student',
  memberKind: 'STUDENT',
  name: '김학생',
  studentId: '260001',
  staffNumber: null,
  department: '인공지능학부',
  phone: '01012345678',
  isComplete: true,
  participations: [
    {
      programId: 'seed:e2e:synthetic-program',
      programName: '합성 오픈소스 프로그램',
      teamName: '합성 팀',
      isLeader: true,
    },
  ],
} as const;

export const SETTINGS_SAVED_NOTIFICATION = {
  notificationEmail: 'staff@example.com',
  notifyEnabled: true,
} as const;
