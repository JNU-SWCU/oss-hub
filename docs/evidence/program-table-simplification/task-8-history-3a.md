# Todo 8 3a: 초대 종료 이중 기록

## 게이트 수정과 범위

후보 `8917ffe6b`의 B2·B3는 후속 `434c814fc` 게이트에서 닫혔다. 남은 R1은 기존 Preparation의 수락·탈퇴까지 410으로 막아 최소 2명 준비를 완료하거나 포기할 수 없던 문제다. 소유자 판정에 따라 새 Preparation 생성만 차단하고 기존 준비의 모든 조작을 복원한다. 배포 파이프라인은 변경하지 않는다.

3a는 TeamHistory 추가와 기존 초대 종료의 이중 기록 단계다. 기존·신규 terminal invitation 행을 일반 종료 경로에서 삭제하지 않는다. Preparation 읽기·소비 경로와 status 읽기를 유지한다. TeamHistory 관련 rollback 계약은 v0.24.42를 유지하며, 작업 브랜치에는 최신 main `c653d023555437d50c06140b6142bc0eee374067` (v0.24.43)을 병합했다. 프론트 제품·E2E·기존 준비 조작 DTO·등록 초기화 구현은 추가로 바꾸지 않는다.

## R1: 새 Preparation만 만들지 않고 기존 준비는 완료 가능

새 Preparation 생성은 인증 확인 뒤 `APP_036 / 410`으로 거부한다. 자신의 준비가 이미 있는 팀장의 멱등 생성 요청은 같은 준비를 반환하며 새 행을 만들거나 이름을 덮어쓰지 않는다. 새 이름·시각을 쓰지 않으므로 생성 서비스의 미사용 인수와 생성 요청 DTO를 제거했다. 기존 HTTP 요청은 그대로 수용하되 이름을 적용하지 않는다. 오류 문구는 새 생성만 중단됐으며 기존 준비는 계속 사용할 수 있음을 안내한다.

기존 준비의 초대·수락·거절·취소·구성원 제외·탈퇴·팀장의 준비 삭제는 기존 권한·기간·정원 검사 아래 정상 동작한다. 원래 capability를 인위적으로 끄지 않는다. 팀장의 canInvite/canRemoveMembers와 팀원의 canLeave가 실제 동작과 일치한다. 팀장은 일반 팀원 탈퇴 대신 기존 `isLeader` 분기의 준비 삭제 버튼을 사용하므로 canLeave=false 의미도 유지한다. 새 UI는 추가하지 않았다.

조회·송신 목록·검색·받은 초대 통합, 신청의 기존 Preparation 소비, 소속·자격 검사, 등록 초기화 활동 검사, 삭제 지문은 유지한다. 기존 신청 소비 트랜잭션의 Preparation 정리도 기존 동작대로 유지한다. 이는 새 준비 데이터를 만드는 writer와 달리 이미 존재하는 준비를 공식 팀·신청으로 옮기는 소비 경로다.

migration의 0건 검사 뒤 구 writer가 데이터를 기록하더라도 새 앱에서 초대를 수락해 기존 신청을 완료하거나 준비를 삭제할 수 있다. 0건을 가정해 NONE을 반환하지 않는다. 3a가 유일한 live 앱인 상태에서 두 테이블이 0이 된 뒤에는 새 준비 생성이 막혀 다시 늘어나지 않는다. 행이 남아 있는 동안에는 기존 조작을 허용하고 reader를 제거하지 않는다. drain/recheck 파이프라인 단계는 추가하지 않는다.

`application-preparations-v02442.fixture.ts`는 v0.24.42 서비스 blob `a8164191988e19f4896e2e7bdb1feed566512584`에서 클래스명만 바꾼 테스트용 구 writer다. 과거 준비 행을 만드는 데 사용하고, 기존 준비의 조작·소비는 현재 서비스로 검증한다. 최소 2명, 팀장 1명, pending 1명의 준비에서 APP_019를 확인한 뒤 현재 API 수락을 거쳐 두 구성원으로 신청을 완료한다. 같은 부족 상태에서 팀장이 준비를 삭제하는 복구도 확인한다.

소유자가 확인한 현재 운영 상태는 Preparation 0건과 모든 프로그램 최소 1명이다. 이번 수정에서 운영 데이터를 다시 조회했다고 주장하지 않으며, 최소 2명 회귀는 지원하는 합성 사례다.

## B2: terminal 행과 기존 rollback 의미 보존

수락은 기존 행을 ACCEPTED로, 거절·취소는 DECLINED로 바꾸면서 respondedAt을 기록한다. 같은 트랜잭션에 TeamHistory INSERT를 추가한다. 일반 종료 경로의 행 삭제는 없다. 이미 처리한 ID는 기존처럼 not-pending이며 목록·프론트 필터·status enum·기본값을 보존한다.

수락의 TeamMember 생성, 다른 대기 초대 종결, 저장소 권한 outbox, 감사 기록은 같은 트랜잭션이다. 다른 팀 합류로 종결한 초대는 INVITATION_CANCELLED와 JOINED_ANOTHER_TEAM 사유를 추가하되 기존 행은 DECLINED로 남긴다. 이력 INSERT나 후속 감사 실패는 status와 가입을 되돌린다.

등록 초기화 repository와 service는 v0.24.42와 동일하다. 실제 DB 회귀는 새 3a 거절 후 구 활동 조회가 true이고, 실제 등록 초기화 서비스가 ROL_025를 반환하며 학생 정보가 보존되는 것을 확인한다. TeamHistory를 읽어야만 얻을 수 있는 보호에 의존하지 않는다. v0.24.42는 이력을 읽거나 기록하지 않지만 legacy 행으로 기존 의미를 유지한다. 전체 구 컨테이너 부팅이나 다른 도메인의 rollback 검증을 수행한 것은 아니다.

## B3: 교직원 팀 삭제의 이력 원자성

권한 확인을 통과한 교직원의 내부 user ID를 기존 팀 삭제 트랜잭션에 전달한다. Team 잠금과 scope fingerprint 확인 뒤 대기 초대마다 INVITATION_CANCELLED, TEAM_DELETED 사유, 교직원 actorId와 동일 삭제 시각을 기록한다. 원래 terminal 행에 새 cancellation을 만들지 않는다.

기존 Serializable 격리, 삭제 범위 검사, 파일 tombstone·레포 정리·알림·감사는 유지한다. 기존 팀 삭제 작업 자체의 하위 행 삭제는 바꾸지 않았다. 새 TeamHistory는 팀 FK가 없으므로 그 삭제 뒤에도 남는다. 두 번째 초대의 이력 INSERT를 실패시킨 회귀는 첫 번째 새 이력과 알림까지 되돌리고 팀·초대·신청·파일 상태가 보존되는지 확인한다.

## SQL과 기존 서버 리허설

TeamHistory migration과 preflight/reconcile SQL은 그대로다. migration SHA-256은 `668e6260dcc0c176003c8897fe6e65b2e9a347e534feee187b0bf1a4212ec286`이다. Prisma schema에는 main의 submission-axis 변경을 병합했다. TeamHistory의 DDL을 바꾸지 않아 서버 리허설은 재실행하지 않았다.

추적 가능한 `deploy/jenkins/program-migration/team-history/prepare.json`의 선행 migration을 `20261104140000_prepare_submission_axis`로 설정했다. 기존 3개 건수 대조를 위한 읽기 전용 count SQL도 함께 둔다. 공식 manifest validator를 통과했고, 로컬 격리 PostgreSQL에서는 submission-axis 다음 TeamHistory가 적용되는 전체 migration 체인과 두 migration의 타깃 테스트를 실행했다. 이 새 predecessor로 운영 서버 리허설을 재실행했다는 뜻은 아니다.

기존 2026-11-04 리허설은 운영 서버 내부의 격리 PostgreSQL에서 공식 도구로 baseline → prepare → 대조 → 백업 복원을 수행했다. dump는 서버 밖으로 옮기지 않았다. network none, 공개 포트 없음, CPU 0.5, 메모리·swap 합계 512 MiB, 데이터 tmpfs 256 MiB, nice 19였다.

| 기존 리허설의 백업 전 / 복원 후 | 전 | 후 |
| --- | ---: | ---: |
| 초대 | 28 | 28 |
| 구성원 | 72 | 72 |
| Preparation 합계 | 0 | 0 |

초대와 구성원의 전체 행 digest 불일치는 0이었다. 새 TeamHistory는 0건이었다.

```text
REHEARSAL_OK name=team-history-3a stages=2 counts=3
CLEANUP containers=0 private_directories=0 EXIT=0
SOURCE_CLEANUP=0
STAGE3A_SERVER_EXIT=0
```

기존 읽기 전용 집계는 Preparation 0, PreparationParticipant 0, PENDING 3, ACCEPTED 20, DECLINED 5였다. 이번 수정에서 새 운영 집계를 했다는 뜻이 아니며 3b의 승인 근거로 재사용하지 않는다. migration의 기존 행 이관·삭제는 각각 0건이다.

## 3b 계획과 rollback 하한

1. 소유자가 3a 운영과 구 앱 종료를 확인한 뒤 두 Preparation 테이블을 읽기 전용으로 재집계한다. 하나라도 0이 아니면 reader·consumer 제거를 중단한다. 기존 조작·신청 완료·준비 삭제를 정상적으로 허용하고, 처리 후 다시 확인하며 자동 폐기하지 않는다.
2. 0건이 확인되면 Preparation reader·consumer·소속/초기화/삭제 지문 참조와 이전 API·DTO를 제거한다. 동시에 등록 초기화를 TeamHistory의 행위자·초대 대상·초대자까지 인식하도록 준비한다.
3. **row 삭제보다 먼저** history-aware reset과 terminal 행의 신규 생성을 중단하는 호환 코드가 실제 운영돼야 한다. 그때까지 pending status 필터를 유지한다. migration이 구 앱보다 먼저 실행되는 현재 배포에서 이 선행 코드와 row 삭제를 같은 배포에 묶지 않는다.
4. 선행 앱만 live인 상태에서 종료 행과 TeamHistory를 대조한다. 기존 이력이 없는 종료 행은 원본 사실을 보존해 멱등 이관하고, 상태·시간·sourceId·건수 대조와 별도 승인을 거쳐 종료 행을 삭제한다. 그 뒤 초대 테이블이 PENDING-only임을 확인하고 status 읽기를 중단한다. 구 writer가 남아 있으면 이 정리를 시작하지 않는다.
5. 3b에서 첫 row 삭제를 허용한 순간부터 rollback 하한은 **TeamHistory-aware reset과 pending-only 계약을 이해하는 선행 3b 호환 릴리스**다. 3a나 v0.24.42로 직접 image rollback하지 않는다. 필요하면 삭제 전 백업 복원과 별도 승인 절차로 다룬다.
6. 물리 status/respondedAt 컬럼과 Preparation 테이블 DROP은 그 다음 별도 승인한 릴리스다. 그 DROP 뒤에는 제거한 컬럼·테이블을 참조하지 않는 최종 3b 앱이 rollback 하한이다. 이번 PR에는 3b 구현이나 DROP을 넣지 않는다.

3b 내부의 호환 코드 배포와 데이터 정리 경계를 실행 전에 분리해 확정해야 한다. 단순히 rollback 하한을 문서에 적는 것으로 구 앱이 live인 동안의 안전성 문제가 해결되지는 않는다.

## 검증 범위와 화면

B2·B3 회귀의 최초 실행은 5 failed / 49 passed였다. Preparation writer 중단 회귀는 8 failed / 9 passed였다. 이후 기존 Preparation 경합 fixture의 새 이력 정리 누락을 수정했다. 실패 테스트를 삭제하거나 skip하지 않았다.

프론트 제품과 기존 E2E를 baseline으로 돌렸다. 현재 사용자 가이드는 이미 지명 신청 흐름을 설명하므로 문구·화면 변경이 없다. PR의 기존 Chrome 캡처는 대기·취소 후 화면이 같다는 소비 화면 참고로만 재사용하며 이번 수정에서 새로 촬영했다고 하지 않는다. 이전 후보의 PENDING-only mock을 현재 API 계약의 증거로 사용하지 않는다.

수정된 코드의 타깃 테스트·타입·lint·원장·push 영수증은 PR 본문의 검증 절에 기록한다. 전체 스위트·독립 gate·merge·release는 root 소유다.

434c814fc까지의 B2·B3 검증은 14 suites / 230개 고유 DB 테스트와 단위·HTTP 13 suites / 242개였다. 그 결과와 게이트의 B2·B3 종료 판정을 유지하며 이번 R1 실행과 혼동하지 않는다.

R1의 red는 11 failed / 2 passed였다. 수정 뒤 DB 5 suites / 59 tests와 공식 manifest validator가 EXIT=0으로 통과했다. 미사용 생성 입력을 제거한 최종 코드에서는 해당 DB suite 13개와 단위·HTTP 2 suites / 9 tests를 다시 통과했다. backend typecheck, 변경 파일 lint, knip와 원장도 EXIT=0이고 `FILE_LEDGER_OK 261 paths`다. 작업트리 전용 Prisma client만 새 main schema로 생성했고 설치는 하지 않았다. 커밋·push의 필수 훅도 그대로 따른다.
