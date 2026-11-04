# Todo 8 3a: 초대 종료 이중 기록

## 게이트 수정과 범위

후보 `8917ffe6b`는 늦은 Preparation 쓰기의 읽기 손실, 구 앱의 등록 초기화 활동 판정 손실, 교직원 팀 삭제의 초대별 이력 누락으로 거절됐다. 이번 수정은 소유자의 B1·B2·B3 판정을 따른다. 배포 파이프라인은 변경하지 않는다.

3a는 TeamHistory 추가와 기존 초대 종료의 이중 기록 단계다. 기존·신규 terminal invitation 행을 일반 종료 경로에서 삭제하지 않는다. Preparation 읽기·소비 경로와 status 읽기를 복원했다. 프론트 제품·E2E 변경, 요청 DTO 제거, history-aware 등록 초기화는 PR에서 거뒀다. 현재 rollback 기준은 `v0.24.42` (`6b7a0d42029bc760eb5985f916a5b3027e8fb024`)다.

## B1: Preparation writer만 중단

Preparation의 생성·초대·수락·거절·취소·구성원 제외·탈퇴 요청은 인증 확인 뒤 `APP_036 / 410`으로 거부한다. 현재 앱이 새 Preparation 상태를 만들거나 변경하지 않게 하는 서버 경계다. 라우트와 요청 DTO는 보존하므로 이전 페이지에도 명시적인 중단 응답을 보낸다.

조회·송신 목록·검색·받은 초대 통합, 신청의 기존 Preparation 소비, 소속·자격 검사, 등록 초기화 활동 검사, 삭제 지문은 유지한다. 기존 신청 소비 트랜잭션의 Preparation 정리도 기존 동작대로 유지한다. 이는 새 준비 데이터를 만드는 writer와 달리 이미 존재하는 준비를 공식 팀·신청으로 옮기는 소비 경로다.

migration의 0건 검사 뒤 구 v0.24.42 writer가 데이터를 기록하더라도 새 앱에서 읽고 기존 신청에 소비할 수 있다. 0건을 가정해 NONE을 반환하지 않는다. 3a가 유일한 live 앱이 된 뒤에만 새 writer가 멈췄다고 판단할 수 있다. 따라서 drain/recheck를 새 파이프라인 단계로 추가하거나 문서상의 수동 조치에 안전성을 의존하지 않는다.

`application-preparations-v02442.fixture.ts`는 v0.24.42 서비스 blob `a8164191988e19f4896e2e7bdb1feed566512584`에서 클래스명만 바꾼 테스트용 구 writer다. 현재 Preparation repository는 같은 태그의 구현을 보존한다. 기존 수명·소비·상호 배제 테스트를 복원했고, 늦은 구 writer의 결과를 현재 reader로 읽고 현재 신청 서비스가 두 구성원을 소비하는 회귀를 추가했다.

## B2: terminal 행과 기존 rollback 의미 보존

수락은 기존 행을 ACCEPTED로, 거절·취소는 DECLINED로 바꾸면서 respondedAt을 기록한다. 같은 트랜잭션에 TeamHistory INSERT를 추가한다. 일반 종료 경로의 행 삭제는 없다. 이미 처리한 ID는 기존처럼 not-pending이며 목록·프론트 필터·status enum·기본값을 보존한다.

수락의 TeamMember 생성, 다른 대기 초대 종결, 저장소 권한 outbox, 감사 기록은 같은 트랜잭션이다. 다른 팀 합류로 종결한 초대는 INVITATION_CANCELLED와 JOINED_ANOTHER_TEAM 사유를 추가하되 기존 행은 DECLINED로 남긴다. 이력 INSERT나 후속 감사 실패는 status와 가입을 되돌린다.

등록 초기화 repository와 service는 v0.24.42와 동일하다. 실제 DB 회귀는 새 3a 거절 후 구 활동 조회가 true이고, 실제 등록 초기화 서비스가 ROL_025를 반환하며 학생 정보가 보존되는 것을 확인한다. TeamHistory를 읽어야만 얻을 수 있는 보호에 의존하지 않는다. v0.24.42는 이력을 읽거나 기록하지 않지만 legacy 행으로 기존 의미를 유지한다. 전체 구 컨테이너 부팅이나 다른 도메인의 rollback 검증을 수행한 것은 아니다.

## B3: 교직원 팀 삭제의 이력 원자성

권한 확인을 통과한 교직원의 내부 user ID를 기존 팀 삭제 트랜잭션에 전달한다. Team 잠금과 scope fingerprint 확인 뒤 대기 초대마다 INVITATION_CANCELLED, TEAM_DELETED 사유, 교직원 actorId와 동일 삭제 시각을 기록한다. 원래 terminal 행에 새 cancellation을 만들지 않는다.

기존 Serializable 격리, 삭제 범위 검사, 파일 tombstone·레포 정리·알림·감사는 유지한다. 기존 팀 삭제 작업 자체의 하위 행 삭제는 바꾸지 않았다. 새 TeamHistory는 팀 FK가 없으므로 그 삭제 뒤에도 남는다. 두 번째 초대의 이력 INSERT를 실패시킨 회귀는 첫 번째 새 이력과 알림까지 되돌리고 팀·초대·신청·파일 상태가 보존되는지 확인한다.

## SQL과 기존 서버 리허설

migration·preflight·reconcile·Prisma schema는 `8917ffe6b` 때와 동일하다. SQL diff 검사 EXIT=0이고 migration SHA-256은 `668e6260dcc0c176003c8897fe6e65b2e9a347e534feee187b0bf1a4212ec286`이다. 소유자 지시에 따라 서버 리허설은 다시 실행하지 않았다.

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

1. 소유자가 3a 운영을 확인하고 3a가 유일한 writer임을 확인한 뒤 두 Preparation 테이블을 읽기 전용으로 재집계한다. 하나라도 0이 아니면 reader·consumer 제거를 중단한다. 기존 소비 또는 별도 승인한 처리를 거친 뒤 다시 확인하며 자동 폐기하지 않는다.
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

이번 수정의 타깃 DB 검증은 중복 실행을 제외한 14 suites / 230 tests가 최종 통과했다. 핵심 5 suites의 첫 실행에서 기존 경합 fixture 정리 누락 1건을 확인했고, 수정 후 인접 10 suites / 152 tests가 통과했다. 두 번째 이력 INSERT 실패를 포함한 팀 삭제 suite는 22 tests로 다시 통과했다.

단위·HTTP는 13 suites / 242 tests가 최종 통과했다. HTTP harness에 운영의 ProblemDetailFilter가 빠져 410 대신 500을 내던 7개 실패는 `configureHttpApp`과 올바른 DTO 본문으로 고쳤고 해당 suite 12개를 다시 통과했다. backend typecheck, knip, 파일 원장도 EXIT=0이며 `FILE_LEDGER_OK 259 paths`다. 변경 파일 lint는 커밋 훅에서 수행한다. SQL이 같으므로 기존 서버 리허설을 재실행하거나 새 결과로 표시하지 않았다.
