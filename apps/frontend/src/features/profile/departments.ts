// 학과 목록은 profile feature만의 것이 아니게 됐다(admin 프로필 수정 화면도 같은 목록을
// 쓴다) — 실제 데이터는 `lib/departments.ts`로 옮기고, 기존 소비자가 그대로 쓸 수 있게
// 여기서는 재수출만 한다.
export {
  DEPARTMENT_GROUPS,
  DEPARTMENT_OPTIONS,
  OTHER_DEPARTMENT,
  type DepartmentGroup,
} from '@/lib/departments';
