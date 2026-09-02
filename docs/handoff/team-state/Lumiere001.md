# @Lumiere001 저널

작성자 저널이다. 새 항목은 파일 끝에만 붙인다. 규칙은 루트 AGENTS.md §3이 원본이다.
| 2026-08-23 | #969 | jwt-auth-signup-refactor | Task 11 작업 중 | Task 11 (canonical authority cutover)을 5개 병렬 subagent로 분해 실행 → 통합 완료. AdminAccessActor fixture에 canonical fields 추가하여 테스트 수정. PR 준비 중. |
| 2026-08-23 | #969 | Task 13 bridge release | canonical application cutover 완료, v0.6.110 롤백을 위해 legacy physical columns/table 유지 | 이전 이미지와 bridge 이미지의 same-schema rehearsal 통과. destructive DROP/rename은 엄격히 이후 migration/PR로 연기. HEAD 7f4ccdc2이며 PR 준비 중. |
| 2026-08-23 | #160/#161 | CD responsibility boundary | builds #160/#161 failed because CD owned an unavailable auth matrix; responsibility moved out of CD; no secrets, URLs, or local paths |

## 2026-08-23 — builds #161-#163 greenfield misclassification hardening

- 상태: active
- Issue: -
- PR: 없음
- blocker: 없음
| 2026-08-24 | #969 | Task 13 contract release | legacy 역할·프로필 호환 계약 제거, 배포된 bridge는 보존하고 엄격히 더 늦은 마이그레이션으로 분리 | `20260823000000_bridge_member_authority`를 byte-for-byte 보존한 채 `20260824000000_contract_member_authority`를 추가했다. 파괴적 DDL 앞에 preflight 11종(미분류 관리자·학번 중복·미상 상태·원장 드리프트 포함)을 세웠고, 실제 PostgreSQL 17 컨테이너에서 contract/contract-negative 리허설을 통과했다(62 사용자·4 요청 id/상태 보존, 백업 복원, 직전 이미지 거부, 4개 중단 레인). 권한과 정체성은 계속 독립이다 — ADMIN에서 회원 유형을 추론하지 않는다. |

## 2026-08-23 — F4 scope cleanup

- 상태: active
- PR: #1007/#1008, #1012
- 내용: 릴리스 사고 창구의 긴급 Jenkins 수정(#1007/#1008)을 소유자 저널에 소급 기록하고, 완료된 회원 권한 backfill stage와 검증기·CI 상태 게이트 잔재를 제거했다. CD는 CI 상태를 읽지 않으며 canonical contract migration(v0.6.112) 이후 backfill을 Jenkins가 소유하지 않는다. `.openchrome` telemetry와 로컬 agent 디렉터리도 공개 저장소에서 제외했다.
- 공개 안전성: 비밀값, URL, 개인 식별 정보 없음.

## 2026-08-23 — F3 최종 통합: STAFF 접근 판정을 사용 가능한 화면 기준으로 교정

- 상태: review
- Issue: #969
- PR: (이 PR)
- blocker: 없음
- 내용: PR #1018 이후 atomic 커밋들로 브랜치를 최종 통합했다. F3가 찾은 근본 결함은 다섯 가지다. canonical STAFF-no-access를 실제로 쓸 수 있는 화면이 아니라 정체성으로 분류했고, 백엔드 로그인 랜딩이 같은 오분류를 그대로 따라갔다. E2E 시드는 staff를 학생으로 잘못 표기했고, 큐의 STAFF는 요청을 처리한 뒤 볼 수 없는 상세를 다시 불러왔으며, 낡은 lifecycle E2E는 이미 삭제된 역할 컨트롤을 조작했다. 고친 방향은 사용 가능한 화면 기준 분류, 온보딩 랜딩 정정, canonical 시드·fixture 정리, 백엔드의 엄격한 가시성은 유지한 채 큐에서 PATCH 응답을 로컬 권위로 투영하는 처리, 그리고 canonical 독립 권한 컨트롤이다. 브라우저 시나리오 7개를 새로 넣었다.
- 검증: 통합 브라우저 14/14, 관리자 lifecycle 6/6, 백엔드 297 suites·3337 tests, 프런트엔드 303 files·3018 tests, typecheck·lint·build 통과. `local:verify`는 마이그레이션 53개와 PostgreSQL·HTTP·MinIO 점검을 끝냈고, 스크린샷 22장에 대한 시각 QA를 2회 돌렸다. blocker는 0이다. 운영 아티팩트는 `.omo/evidence/jwt-auth-signup-refactor/final/f3-summary.json`이다.
- 배포: 현재 production read-only 점검은 정상이지만 이번 수정은 아직 배포 전이며 다음 PR·릴리스에서 나간다. 스키마·마이그레이션 변경이 없어 DB 작업 없이 v0.6.112 애플리케이션 이미지로 롤백할 수 있다.
- 공개 안전성: 비밀값, 행 데이터, 실명, IP, 로컬 경로, 증적 절대 경로 없음.

## 2026-08-24 — F4 감사 하드닝 마무리와 append-only 복구

- 상태: done
- Issue: #969
- PR: #1021
- blocker: 없음
- 내용: #1019로 F3 인증·세션 수정을, #1020으로 F4 테스트·감사 하드닝을 내보냈다. #1020 병합 뒤 감사에서 #1020이 앞선 F3 저널 항목의 문구를 붙이지 않고 고쳐 쓴 사실을 확인했다. 그 문구는 다시 건드리지 않는다. append-only 원칙은 이 항목부터 복구되며, 앞으로의 상태 전이는 새 항목을 붙이기만 한다. 현재 남아 있는 앞선 문구는 개수에 의존하지 않는 서술이라 사실과 어긋나지 않고, 따라서 남은 의미 교정은 없다.
- 검증: #1019와 #1020은 CI green을 요구했다. 최종 scope·security 감사는 수정 뒤 blocker·high·medium·low 0으로 PASS다. 프런트엔드 304 files·3032 tests, 실패 경로 Playwright 3/3, browser-audit 14 tests, 순수 LOC 177이다. typecheck·lint·format 모두 PASS다.
- 배포: #1021은 문서 전용이다. 제품 코드·스키마·마이그레이션·lockfile 변경이 없고 DB 작업이나 롤백 절차도 바뀌지 않는다. 제품 릴리스는 이 PR 뒤에 이어진다.
- 공개 안전성: 비밀값, 행 데이터, 실명, IP, 로컬 경로 없음.

## 2026-08-28 — Vitest ESM 설정 경계 정렬

- 상태: review
- Issue: -
## 2026-08-28 — 사람 중심 마일스톤 작성·제출 흐름

- 상태: review
- Issue: #1033, #1035
- PR: (이 PR)
- blocker: 없음

## 2026-09-01 — 접근 관리 화면 역할 비노출 경로 이전

- 상태: review
- Issue: #1038
- PR: (이 PR)
- blocker: 없음
- 내용: 접근 관리 화면과 상세 intercept 경로를 `/admin/access`에서 `/dashboard/users`로 옮기고, 메뉴·대시보드·local-review·브라우저 검증 경로를 같은 주소로 정렬했다. 구 역할 노출 주소에는 redirect를 남기지 않았다.
- 검증: 프런트엔드 317개 파일·3177개 테스트와 별도 런타임 geometry 4개 테스트, 목록 클릭→상세 오버레이→새로고침 표준 상세 Playwright 1개, typecheck·lint·format·production build를 통과했다. lint 경고 5건은 기존 sidebar drawer 테스트의 경고이며 새 오류는 없다.
- 공개 안전성: 비밀값, 실데이터, 개인정보, 내부 호스트, 로컬 경로 없음.

## 2026-09-01 — E2E 세션 목을 현재 인증 계약으로

- 상태: review
- Issue: #1086
- PR: (이 PR)
- blocker: 없음
- 내용: member-authority 이관으로 세션 응답에서 `role`이 사라지고 권한 필드(`memberKind`·`hasStaffAccess`·`hasAdminAccess`)로 갈렸는데, 두 스펙의 손으로 적은 목은 옛 모양 그대로였다. 화면이 그 목을 권한 없는 사용자로 읽어 편집 화면 요청을 랜딩으로 돌려보냈고, 실패는 「제목을 못 찾음」으로만 보여 원인을 가렸다. 목을 `e2e/support/session-mock.ts` 한 곳으로 모으고 `Me` 타입을 참조하게 해, 다음 계약 변경은 브라우저 실행이 아니라 typecheck가 먼저 잡는다.
- 검증: lint·typecheck 통과, frontend 319 파일·3188 테스트 통과. `program-edit-purge-network.spec.ts` 는 수정 전 4건 전부 `openEdit` 에서 죽었고 수정 후 3건 통과·1건은 화면에 도달한 뒤 다른 단언에서 실패한다.
- 남은 것: 그 1건(`scope drift reports precise error without retry`)은 세션과 무관한 별개 문제다. 게이트가 막혀 있는 동안 한 번도 실행되지 않았던 자리이며, 제품 결함인지 스펙의 낡은 기대인지 아직 가리지 못했다. 별도 티켓으로 올린다.
## 2026-09-01 — 제출 파일 크기 안내 숫자 정정

- 상태: review
- Issue: #1106
- PR: (이 PR)
- blocker: 없음
- 내용: 실제 상한은 5 MiB인데(백엔드 `MAX_FILE_BYTES`·multer `fileSize`, 프런트 `SUBMISSION_FILE_MAX_BYTES` 셋 다) 안내 문구만 「50 MiB」였다. 학생은 그 말을 믿고 6 MiB 파일이 왜 막히는지 알 수 없었다. 백엔드 SUB_019 문구와 프런트 같은 문구를 실제 값에 맞췄고, 같은 저장소의 프로그램 작성 업로드가 이미 쓰던 표현(`파일은 5MiB 이하여야 합니다.`)에 맞췄다.
- 검증: lint·typecheck 통과, backend 309 스위트·3470 테스트, frontend 319 파일·3189 테스트 통과.
- 주의: 기존 테스트가 잘못된 문구를 기대값으로 고정하고 있었고 경계 테스트 이름도 「50 MiB」로 잘못 적혀 있어 함께 바로잡았다. 그래서 이 결함이 초록 신호 아래 숨어 있었다.
## 2026-09-01 — 신청자 목록 검색 중 입력 초점 유지

- 상태: review
- Issue: #1094
- PR: (이 PR)
- blocker: 없음
- 내용: 검색창에 한 글자를 넣는 순간 화면이 스켈레톤으로 바뀌며 입력이 화면에서 사라져 초점을 잃었고, 두 번째 글자를 이어서 칠 수 없었다. 사용자가 치는 값(`searchInput`)과 조회 조건(`query.search`)을 갈라 두고 300ms 디바운스를 걸었으며, 「갱신 중」을 `loadState` 가 아니라 별도 플래그로 옮겨 조회 중에도 검색창과 표가 화면에 남게 했다. 디바운스 값과 훅은 팀 초대 검색(`program-teams-page`)이 이미 쓰던 `useDebouncedValue`·300ms 를 그대로 재사용했다.
- 검증: lint·typecheck 통과, frontend 319 파일·3192 테스트 통과. 대조 실험으로 제품 코드만 수정 전으로 되돌리면 새 테스트 3건이 실패하는 것을 확인했다.
- 주의: 「갱신 중」을 `loadState` 에 담으면 폴링 effect 가 그것을 의존성으로 보고 정리 함수에서 `requestEpoch` 를 무효화해, 방금 띄운 요청이 스스로 늦은 응답 취급을 받는다. 그래서 별도 플래그로 뺐다.
## 2026-09-01 — 프로그램 상세 활동 영역 앵커 이동 복구

- 상태: review
- Issue: #1088
- PR: (이 PR)
- blocker: 없음
- 내용: `/programs/{id}#activity` 로 들어가도 화면이 맨 위에 머물렀다. 앵커 이동 효과가 마운트 직후 한 번만 도는데, 상세와 그 안의 활동 그래프가 각자 늦게 채워져 그 시점에는 셸의 스크롤 칸이 아직 내용보다 크지 않다. 그래서 `scrollIntoView` 가 조용히 아무 일도 못 하고 끝났다. 프로그램 본문의 실제 크기 변화를 관찰해 활동 영역을 다시 맞추고, 사용자가 스스로 스크롤하면 그 자리에서 관찰을 끝낸다 — `scroll` 은 우리가 만든 이동도 똑같이 내보내므로 주도권 판단 근거로 쓰지 않고 wheel·touchstart·keydown·pointerdown 을 본다.
- 검증: 최신 `main` 반영 뒤 전체 frontend 320개 파일·3,201개 테스트와 변경 파일 lint·frontend typecheck·format을 통과했다. 실제 Chrome E2E 4건에서 모바일 390px·데스크톱 1280px·해시 없는 진입·사용자 wheel 입력을 확인했다. 전체 E2E 기본 프로필은 이 PR과 무관한 #1139의 미병합 시드 오류로 시작 전에 중단되어, 해당 화면에 필요한 `program-authoring` 프로필로 브라우저 시나리오를 검증했다.
- 주의: 스펙이 활동 응답을 빈 배열에서 6건으로 바꿨다. 활동 그래프가 로딩 중에는 96px 자리만 차지하다 데이터가 온 뒤 자라므로, 빈 응답으로는 이 결함이 재현되지 않는다.
## 2026-09-01 — 프로그램 서류 화면 통합과 단계 집중 보기

- 상태: review
- Issue: #1042
- PR: (이 PR)
- blocker: 없음
- 내용: 학생과 교직원의 프로그램 서류 진입을 `/programs/[id]/documents`로 통합하고 역할에 따라 개인 체크리스트 또는 제출 현황 매트릭스 하나만 표시한다. 기존 MyDocs 전용 화면은 Documents 화면에 흡수했다. 교직원은 PC 왼쪽 메뉴, 태블릿 상단 단계 버튼, 모바일 단계 선택창에서 모든 단계 또는 한 단계에 집중해 볼 수 있다. `/status`와 `/mydocs`는 리다이렉트 없이 제거했고, 기존 `/submissions`와 마일스톤 제출 진입만 호환 경로로 유지했다. 단계 탐색에는 기존 공개 프로그램 상세 조회를 사용하며 backend, DB, 인가 계약은 바꾸지 않았다.
- 검증: 프런트엔드 321개 파일·3209개 테스트, typecheck, format, production build를 통과했다. lint는 오류 0건이고 기존 sidebar drawer 테스트 경고 5건만 남는다. PC 1280px, 태블릿 768px, 모바일 375px에서 역할 분리, 단계 선택·스크롤 고정, 키보드 초점, 구 경로 404, 모바일 표 내부 가로 스크롤, 긴 한국어 안내와 파일명 폭을 확인했다.
## 2026-09-01 — 접근 권한 변경 인가 범위 좁히기

- 상태: review
- Issue: #1082
- PR: (이 PR)
- blocker: 없음
- 내용: 관리자가 아닌 행위자의 접근 권한 변경을 인가할 때 결정 유무만 보던 것을, 결정 말고는 아무것도 바꾸지 않는 명령인지까지 확인하도록 좁혔다. 승인은 그 자체가 교직원 접근을 부여하므로 그만큼은 결정의 결과로 두고, 그보다 넓은 권한과 계정 상태 변경은 거절한다. 어느 역할이 교직원 부여인지는 전이표의 `isStaffOnlyAccess`를 그대로 쓰도록 `export`만 넓혔다.
- 검증: backend 단위 309 스위트·3475 테스트, 통합 88 스위트·463 테스트, lint·typecheck·prettier 통과. 추가한 회귀 테스트 6건은 수정 전 3건이 실패하고 수정 후 전부 통과하는 것을 확인했다. 실제 HTTP 왕복으로도 수정 전 200(권한 부여됨) → 수정 후 403(권한 변화 없음)을 확인했고, 교직원의 순수한 반려는 양쪽 모두 200으로 유지된다.
- 남은 것: 전이표의 반려 분기가 모순되는 교직원 부여만 막고 관리자 부여는 통과시킨다. 관리자 행위자에게는 권한 상승이 아니라 이 티켓 범위 밖으로 두었고 PR 본문에 남겼다.
- 공개 안전성: 비밀값, 실데이터, 개인정보, 내부 호스트, 로컬 경로 없음.
