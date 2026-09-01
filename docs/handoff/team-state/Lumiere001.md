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

## 2026-09-02 — 셸 라우팅 역할 노출 경로 잔재 정리

- 상태: blocked
- Issue: #1041
- PR: 없음
- blocker: 기준선의 날짜 의존 단위 테스트 #1144 해결 대기
- 내용: 셸의 섹션 판정에서 제거된 `/admin/*` 경로를 대시보드로 접던 분기를 삭제했다. 프런트엔드 코드·테스트·브라우저 tombstone·설계 미리보기에 남은 역할 노출 주소를 역할 중립 대시보드 계약에 맞췄고, 구 주소는 redirect 없이 404로 남겼다. 백엔드·인가 정책·라우트 디렉터리는 변경하지 않았다.
- 검증: QA113 변경은 프런트엔드 319개 파일·3193개 테스트와 백엔드 309개 suite·3469개 테스트, 구 주소 tombstone 3개 발견, typecheck·lint·format·production build 및 별도 목표·코드 품질·실행·보안·저장소 맥락 검토를 통과했다. 최신 기준선 재검증에서는 #1144의 고정 마감일이 지나 root test가 실패해 PR 제출 게이트가 차단됐다.
- 공개 안전성: 비밀값, 실데이터, 개인정보, 내부 호스트, 로컬 경로 없음.

## 2026-09-02 — 셸 라우팅 잔재 정리 리뷰 재개

- 상태: review
- Issue: #1041
- PR: (이 PR)
- blocker: 없음
- 내용: 기준선의 날짜 의존 실패는 #1150 병합으로 해소됐다. 최신 `main`을 충돌 없이 합친 뒤 셸·설계·local-review가 역할 중립 대시보드 주소만 인식하고, 제거된 `/admin/*` 주소는 redirect 없이 404로 남는 계약을 다시 확인했다. 백엔드 제품 코드·인가 정책·데이터 모델은 변경하지 않았다.
- 검증: 프런트엔드 319개 파일·3193개 테스트와 백엔드 309개 suite·3472개 테스트, 구 주소 tombstone 3개 발견, typecheck·lint·format·production build를 최신 기준선에서 통과했다. lint 경고 5건은 기존 sidebar drawer 테스트의 경고이며 새 오류는 없다.
- 공개 안전성: 비밀값, 실데이터, 개인정보, 내부 호스트, 로컬 경로 없음.
