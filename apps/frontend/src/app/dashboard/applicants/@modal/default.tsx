// 병렬 라우트 `@modal` 슬롯의 기본값. 소프트 클릭으로 인터셉트된 상태가
// 아니면(예: `/dashboard/applicants` 직접 진입, `/dashboard/applicants/users/[userId]`
// 직접 진입·하드 새로고침) 이 슬롯은 아무것도 렌더링하지 않는다.
export default function ApplicantQueueModalDefault() {
  return null;
}
