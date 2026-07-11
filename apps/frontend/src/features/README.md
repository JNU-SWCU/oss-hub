# Feature 폴더 규약

기능 단위 폴더에는 해당 기능의 컴포넌트, hooks, 상태, 타입, 테스트를 함께 둡니다. 페이지는 기능을 조합하는 역할만 맡고, 다른 feature의 내부 경로에 직접 의존하지 않습니다.

API 요청은 모든 feature에서 `src/lib/api-client.ts`만 사용합니다. feature의 `api.ts`에는 endpoint별 함수와 DTO 변환만 두며 `fetch` 또는 별도 HTTP 클라이언트를 만들지 않습니다.
