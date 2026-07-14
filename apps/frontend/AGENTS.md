# apps/frontend — 에이전트 작업 규칙

원본 규칙은 [docs/rules/frontend.md](../../docs/rules/frontend.md)(구조)와
[ADR-004](../../docs/decisions/ADR-004-REST-API-규격.md)(API 계약)다. 이 파일은 폴더 라우팅용 요약만 담는다.

## 폴더 규칙

- `src/app/` — 라우팅과 페이지 조합만. 페이지는 feature를 조합할 뿐 업무 로직·데이터 fetch를
  직접 두지 않는다.
- `src/features/<기능>/` — 기능 단위 응집(components/, hooks/, types.ts, api.ts).
  다른 feature의 내부 경로를 import하지 않는다 — 공유가 필요하면 공용 계약으로 추출.
- `src/features/<기능>/api.ts` — endpoint별 함수와 DTO 변환만. `fetch`·별도 HTTP 인스턴스·
  `/api/v1` 문자열을 새로 만들지 않는다.
- `src/lib/` — 공유 유틸. `lib/api-client.ts`가 유일한 HTTP 클라이언트이자 `/api/v1` 문자열의
  유일한 소유자다. URL이 필요한 곳(링크 href 포함)은 여기의 export를 사용한다.
- 여러 feature가 공유하는 순수 UI가 생기면 `src/components/`로 올린다.
- dev 환경의 `/api/v1` 프록시는 `next.config.ts` rewrite가 담당한다 — 코드에 backend 절대
  URL을 쓰지 않는다.

## API 계약 (ADR-004 요약)

- 성공 응답 = 순수 DTO, 실패 = ProblemDetail + 도메인 `code`. 필드는 camelCase,
  enum 값은 UPPER_SNAKE_CASE, boolean은 is/has/can 접두사.
- 목록 API는 항상 페이지네이션 전제로 소비한다.

## 금지

- 실명·학번·개인 머신 경로를 코드·주석·fixture에 넣지 않는다
  (PUBLIC repo — [security.md](../../docs/rules/security.md)).
- 실데이터 fixture 금지 — 합성 데이터만.
