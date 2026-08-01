// PR04F — 병렬 라우트 `@modal` 슬롯의 기본값. 소프트 클릭으로 인터셉트된
// 상태가 아니면(예: `/admin/access` 직접 진입, `/admin/access/users/[userId]`
// 직접 진입·하드 새로고침) 이 슬롯은 아무것도 렌더링하지 않는다.
export default function AdminAccessModalDefault() {
  return null;
}
