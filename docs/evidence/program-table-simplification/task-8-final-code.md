# Todo 8 최종 코드 전환

기준 main은 484bb8f82다. 이 PR을 먼저 배포하고, 물리 삭제 draft는 그 다음 릴리스에서만 적용한다. 이번 PR은 SQL migration·운영 데이터 쓰기·merge·배포를 하지 않는다.

## 계약과 제거

TeamInvitation은 대기 중인 행만 반환한다. status·respondedAt·준비팀 여부를 API와 프론트 타입에서 제거하고, 모든 조작은 team-invitations 경로만 사용한다. Program → Team → User 잠금, 정원·학생 자격·프로그램별 소속 검사와 삭제·이력·가입·outbox의 원자성은 유지한다. 팀 삭제의 terminal archive fallback은 선행 pending-only CHECK 아래 도달 불가능하여 제거한다. 과거 TeamHistory JSON은 수정하지 않는다.

Prisma 모델에서도 두 컬럼과 두 준비 모델·enum을 제외했다. 따라서 include와 기본 SELECT도 status를 읽지 않고 INSERT도 쓰지 않는다. 기존 물리 status의 PENDING 기본값과 pending-only CHECK가 새 INSERT를 보장한다. 새 DB 기본값 migration은 필요 없다. 선언한 전체 UNIQUE와 invitee 인덱스의 물리 교체는 다음 draft에만 둔다. 지금의 partial UNIQUE와 복합 invitee 인덱스가 같은 대기 행 계약을 보장한다.

삭제한 파일은 application-preparations.controller.ts (12줄), dto/my-application-preparation-response.dto.ts (7줄), frontend application-preparation-notice.tsx (62줄), users/member-registration-reset-v02444.fixture.ts (39줄)이다. 구조 표의 나머지 준비 서비스·저장소·오류 파일은 선행 main에서 이미 삭제됐다. src의 preparation 대소문자 검색은 두 앱 모두 0건이다. 과거 migration·migration fixture·대조 SQL·과거 증거 문서는 이 검색 범위가 아니다. 파일 원장을 갱신했고 프로그램 제품 파일은 234→232, 36908→36768줄이다.

폐기한 준비 GET·조작·준비 화면 및 구 이미지 실행의 테스트만 제거했다. 이전 준비 INSERT 차단은 기존 migration fixture가 계속 검증한다. 현재 등록 초기화의 세 이력 역할 보호, 실제 거절 후 활동 보호, 팀 삭제 후 이력 보존·실패 원자성, 재초대·중복·경합 테스트는 유지했다. 종료 행 CHECK의 과거 쓰기 검사는 기존 terminal migration 테스트가 소유한다. 테스트를 skip하거나 실패를 무시하지 않았다.

## 운영 읽기 전용 집계

2026-11-05 첫 관측은 retire 배포 전이었다: PENDING 3, terminal 25, respondedAt 비NULL 25, 두 준비 테이블 각각 0, migration head prepare_invitation_archival. 릴리스가 완료된 뒤 다시 읽어 아래를 확인했다. 두 조회 모두 BEGIN READ ONLY와 ON_ERROR_STOP을 사용했고 EXIT=0이다.

| 최종 항목 | 건수 |
| --- | ---: |
| PENDING | 3 |
| terminal | 0 |
| respondedAt 비NULL | 0 |
| ApplicationPreparation | 0 |
| ApplicationPreparationParticipant | 0 |

최종 migration head는 20261104190000_retire_terminal_invitations다. 이 작업에서 운영의 행·컬럼·테이블을 삭제한 건수는 모두 0이다.

## 검증

- 응답 계약 최초 red: create-search 2 failed / 12 passed, EXIT=1. 변경 후 대상 단위·HTTP·인증·DTO 10 suites / 222 tests, EXIT=0. DTO snapshot은 status·respondedAt 제거 2개와 폐기 응답 1개만 바뀐다.
- 실제 PostgreSQL 대상: applications.service, applications-named-invitees, team-invitations 전체, program-team-membership, program-team-deletion, program-deleted-write, program-purge, member-registration-reset. 12 suites / 219 tests, EXIT=0. 빈 DB에서 전체 migration 체인 적용도 성공했다.
- 이력 변이: recordInvitationClosed가 항상 INVITATION_CANCELLED를 쓰게 바꾸자 초대 repository 2 failed / 29 passed, EXIT=1. 바이트 복원 후 같은 suite 31 passed, EXIT=0. 복원 SHA-256 d0aa7cf65169bbcbe3ac70fbb0c88e0d281fba1afd640a303fa9d67b9999f9ef.
- 프론트 applications·teams 대상: 처음 39 files / 558 tests 중 4개가 폐기 boolean 인수 기대 때문에 실패했다. 해당 검색 테스트와 변경한 초대 테스트를 다시 실행해 4 files / 53 tests, EXIT=0. 기존 나머지 38 files는 통과했다.
- Chrome page.route 합성 API: 두 폭 1440×1000과 390×844에서 지명→지원 제출→우리 팀 대기 초대→정원 오류→기간 종료를 확인했다. Before 2 tests, 최종 After 2 tests 통과. status가 없는 실제 새 응답 형태를 사용한다. 첫 After 실패로 남아 있던 roster status 필터를 찾아 제거했다.

계획 QA의 최소 2명 프로그램 혼자 지원 성공이라는 옛 문구 대신, 선행 소유자 결정대로 본인+지명 인원 최소 검사와 실제 수락 인원 승인 검사를 유지한다. 최소 1명만 혼자 지원할 수 있다. 이 계약을 완화하지 않았다.

화면 배치와 현재 사용자 문구는 같다. 현재 guide가 지명→수락 흐름을 이미 설명하고 있어 guide 수정은 없다. 캡처는 합성 사용자·프로그램과 고정 시각을 사용한다. 서버와 Chrome은 각 실행의 finally에서 닫는다. 코드-only PR로 기존 행 이동·삭제가 없어 운영 서버 컨테이너 리허설은 해당하지 않는다.

전체 unit·integration suite는 실행하지 않았다. CI와 독립 gate는 merge 전 관문이다. stale_state는 빈 DB migrate deploy, dirty_worktree는 전용 worktree와 명시적 diff, misleading_success_output은 실제 suite·test 수·EXIT, flaky_tests는 재시도 없는 실행과 변이 복원으로 확인했다. 운영 장애·배포 실패 주입은 이 코드 PR에 해당하지 않는다.

정적 검사: backend·frontend typecheck와 lint, format:check, check:file-ledger는 EXIT=0이다. lint의 기존 boundaries 경고와 프론트 링크 목 4개 경고는 유지했다. 구조 검사의 미사용 CreatedTeam은 폐기 API의 반환 타입이므로 제거했고 후속 structure 결과로 확인한다. 파일 원장은 FILE_LEDGER_OK 261 paths다. 설치 시도는 자동 설치를 금지하지 않은 임시 Prisma schema 위치에서 실패했으며 재설치 프롬프트에는 응답하지 않았다. 이후 자동 설치 금지와 작업 트리 전용 client 출력으로 생성했다. lockfile 변경은 없다.

최종 구조 검사는 CreatedTeam 제거 뒤 EXIT=0이다. 최종 소스 Chrome도 2 tests / EXIT=0이며 기존 공개 첨부를 이 캡처로 갱신했다. 릴리스 자산 첨부만 수행했고 새 release 발행·배포는 하지 않았다.

과거 user-consolidation drift 하네스가 현재 도메인 schema와 옛 User fixture를 합치는 경계도 확인했다. 삭제된 두 준비 관계가 미정의 모델을 가리키므로 옛 User fixture의 두 관계 선언만 제거했다. 과거 물리 migration·fixture SQL은 보존했다. 실제 격리 DB의 user-consolidation-migration 1 suite / 11 tests와 before/after drift 대조가 EXIT=0이다.
