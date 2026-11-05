# Todo 4 실제 화면 QA

Before frontend는 main 04ed6b30c, After frontend는 f00b1b589의 실제 Next production 번들이다. After 후속 커밋은 backend 집계·회귀·유휴 타입 정리와 증거 문서이며 캡처한 렌더 컴포넌트는 동일하다. 두 번들을 같은 loopback origin과 포트에서 순차 실행했고 API만 page.route로 합성 응답을 제공했다. 실제 저장·인가·트랜잭션은 별도 backend 통합 테스트로 검증한다.

합성 교직원·신청자, 제출 revision1, 현재 review null, 과거 unknown revision APPROVED와 코멘트·시각을 동일하게 제공했다. Before는 미검토와 빈 이전 이력, After는 제출본 연결 미상 및 별도 과거 승인 사실을 보여 준다. 현재 revision에 심사를 추정해 붙이지 않았다.

Before 1440×900·390×844의 light/dark 4개 context, After 같은 4개와 2560×1440·1728×1000의 light 2개를 검사했다. browser error0·누락 API mock0·가로 overflow0이다. dark는 기존 .dark 토큰을 적용했다. 1440 light에서 승인 선택→저장을 눌러 expectedRevision1·expectedLatestReviewId axis-old-review를 항목 심사 endpoint로 보내고 성공 안내를 확인했다. 이는 실제 운영 쓰기가 아닌 mock 와이어 검증이다.

요소 캡처는 같은 selector를 사용했다: 현재 제출본 [aria-label="검토 대상 제출본"], 이전 이력 section:has(> #revision-history-title), 마일스톤 [data-testid="milestone-row"]. 마일스톤의 외형·요약은 유지됨을 확인했다. sidebar countdown은 고정된 미래 마감에 대한 실제 시계를 사용해 초 단위가 다르며 비교 대상이 아니다.

26개 PNG를 직접 확인한 합성 상태에서 이미 published 상태인 v0.24.54에 추가했다. 새 release는 만들지 않았다. 핵심6개 링크는 HEAD200을 확인했다. PR #1748 본문에 요소 전후와 desktop/mobile, dark·넓은 화면 링크를 첨부한다. PNG는 Playwright가 새로 생성해 개인정보·EXIF·토큰·개인 경로가 없다.

Before와 After의 모든 browser context는 finally에서 닫았고 각 production 서버를 종료했다. 포트3124 LISTEN0을 확인했다. 임시 base export와 그 전용 node_modules도 제거했다. 운영 서버·사용자 세션은 변경하지 않았다.
