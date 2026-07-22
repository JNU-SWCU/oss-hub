export interface DepartmentGroup {
  readonly label: string;
  readonly departments: readonly string[];
}

export const DEPARTMENT_GROUPS: readonly DepartmentGroup[] = [
  {
    label: 'SW학과',
    departments: ['인공지능학부', '소프트웨어공학과', '컴퓨터정보통신공학과'],
  },
  {
    label: 'SW융합학과',
    departments: [
      '빅데이터융합학과',
      '지능형모빌리티융합학과',
      '로봇공학융합전공',
      'IoT인공지능융합전공',
      '빅데이터금융공학융합전공',
      '지능실감미디어융합전공',
    ],
  },
  {
    label: 'SW융합트랙',
    departments: [
      '전자공학과(AI스마트전장SW트랙)',
      '융합바이오시스템기계공학과(생물산업기계공학SW트랙)',
      '문헌정보학과(문헌정보SW트랙)',
      '교육학과(교육SW트랙)',
      '문화콘텐츠학부(멀티미디어SW융합트랙)',
      '문화콘텐츠학부(E-biz소프트웨어트랙)',
    ],
  },
];

export const DEPARTMENT_OPTIONS = DEPARTMENT_GROUPS.flatMap(
  (group) => group.departments,
);

export const OTHER_DEPARTMENT = '__OTHER__' as const;
