# Todo 4: #1750 반영 후 재검증

두 PR은 #1750의 main cbe80bc61baabcbdb661bff37d0eae60a86052b2를 조상으로 포함한다. B는 새 A 위에 별도 다음 릴리스로 쌓는다. 옛 program-team-deletion.repository.ts, program-teams.repository.ts, team-deletion-scope.repository.ts를 되살리지 않았다.

## 이동된 파일에 재적용한 변경

새 team.repository.ts에서 TeamDeletionScopeRepository의 정규 이력 scope·fingerprint, deleteTeamTree의 A용 물리 FK 정리, TeamApplicationRow와 TeamRepository의 항목 중심 조회를 재적용했다. 각 선언의 #1750 이전 main 본문과 이동된 새 본문이 동일한지 확인한 뒤 A 변경만 이식했다. 새 TeamRepository 이름과 main의 PrismaTypes alias를 유지했다. B는 동일 새 파일에서 폐기 테이블을 참조하는 유일한 정리 SQL을 제거한다.

main의 원장 경로·이동 상태를 보존하고 A가 삭제한 제출 전용 service·DTO의 상태만 셀 단위로 합쳤다.

## 기존 guard 보존과 CI 회귀

남아 있는 *.guard.ts 코드의 main 대비 diff는 0이다. role snapshot의 기존 33개 경로는 main에서 폐기 경로만 뺀 결과와 status·error까지 동일하다. 제거한 경로는 다음 6개뿐이다.

- GET /api/v1/programs/:programId/milestones/:milestoneId/submission-form
- GET /api/v1/programs/:programId/submissions/me
- POST /api/v1/submission-files
- POST /api/v1/submissions
- POST /api/v1/submissions/:submissionId/resubmissions
- POST /api/v1/submissions/:submissionId/reviews

POST /api/v1/submission-files/checks는 유지한다. 현재 route manifest는 130개이며 public12·optional5·protected113이다. 남은 경로의 Origin·권한 오류 순서는 바꾸지 않았다. 제거한 심사 POST는 모든 actor와 Origin에서 404로 검증한다.

rebased head에서 manifest·role snapshot·anonymous guard·purge/team graph·lockProgramTree·ProgramEditor edit counts·submission history ORM 경계·POST retirement 및 TeamRepository 단위 15개 파일, 216개 테스트가 통과했다. 실제 PG에서 팀 삭제·purge·회원 초기화·현재 파일 인가·불변 심사 통합 5개 파일, 90개 테스트도 통과했다. fresh Prisma generate와 소비하는 검사를 /tmp/oss-hub-heavy.lock 한 hold 안에서 실행했다. 타입 검사 EXIT0이며 shared client schema가 검사 중 바뀌지 않았다.

## 이전 실측·캡처와의 연결

실측 원본의 source는 main04ed6b30c / 후보0d3d44556이며 그 원시 표본을 수정하지 않았다. 클래스명 ProgramTeamsRepository→TeamRepository와 Prisma 타입 alias만 정규화한 AST 비교에서 측정한 네 repository 구현이 현재 코드와 모두 동일했다.

- apps/backend/src/programs/program-overview.repository.ts → apps/backend/src/programs/program-overview.repository.ts: 동일
- apps/backend/src/programs/submission-matrix.repository.ts → apps/backend/src/programs/submission-matrix.repository.ts: 동일
- apps/backend/src/programs/milestone-document-collection-read.repository.ts → apps/backend/src/programs/milestone-document-collection-read.repository.ts: 동일
- apps/backend/src/programs/program-teams.repository.ts → apps/backend/src/programs/team.repository.ts: 동일

캡처한 frontend f00b1b589의 review-submission, revision-history, submission-review-view, milestone-row 네 컴포넌트는 현재 파일과 byte 단위로 같다. 따라서 동작이 같은 파일 이동 때문에 측정·캡처를 반복하지 않았다. 이 기록은 현재 head를 새로 timing 측정했다는 주장이 아니다. 공개 PR의 inline 비교 이미지6개가 실제 decode된 것도 확인했다.

## 새 main 대비 제품 코드

테스트·fixture·support를 제외한 programs 제품 코드는 main 215개·36605줄에서 A 208개·33518줄이다. 이전 문서의 232→225와 줄 수는 #1750 이전 source에 대한 기록이다.

## SQL 리허설 동일성

DB 변경이 없는 #1750 반영 후에도 성공한 서버 격리 리허설과 PR SQL의 SHA-256이 같다.

- A040000: c4bbaf8a141d4a98ffe5d79803eaf45c0a2555f4c365adcb28fb8549367f06b2
- B050000: 8b48dd4813e8bbc612ab8be03f133a9e039895581381b5c89a18f44b4688012b

운영 DB 쓰기·PR merge·배포·Jenkins 실행은 수행하지 않았다. 과거 unknown revision 승인1건은 추정 없이 보존한다.

