# Todo 2 retire: prepare 배포 확인과 삭제 승인 자료

2026-11-04 KST. 모든 운영 작업은 읽기 전용이었다. 운영 INSERT/UPDATE/DELETE/DDL, 새 덤프·복원, Release 생성, 배포, PR ready/merge를 수행하지 않았다. PR #1719는 main 기준 draft로 유지한다.

## 관측 시점과 중단 이후 변경

처음 확인한 준비 릴리스는 v0.24.30 `4aa54c6657cf2ece5e02f2534209e27d3bf67031`이다. 호스트 프로세스 재시작 전 완료된 검증을 다시 실행하지 않고 기존 로그를 보존했다.

그 사이 v0.24.31 `adc22bdb4b9e72763ebd93fb19ef359efd6ffb94`이 2026-11-03T16:38:47Z에 발행됐다. 재개 후 현재 backend와 Vercel production은 v0.24.31이다. v0.24.30 이후 변경은 프론트 차트 focus 설정과 가이드뿐이며 backend 소스와 migration 변경은 없다. 따라서 현재 앱도 prepare 앱이다. v0.24.30이 계속 현재 버전이라고 주장하지 않는다.

아래 DB 행 수·제약은 2026-11-03T16:33:14Z에 완료한 읽기 전용 스냅샷의 값이다. 교체 이후 생성 행 집계는 2026-11-04T00:18:19Z에 별도로 완료했다. 운영 화면 QA는 재개 후 현재 번들에서 수행했다.

## v0.24.30 backend 배포

- Jenkins #9235: SUCCESS, running=false, Release SHA 일치.
- 실행 시작 2026-11-03T16:22:00.733Z, 소요 174,326ms.
- 배포 로그에서 prepare migration, `ACTIVATION=ok`, `RELEASE_SMOKE=ok`를 확인했다.
- 운영 호스트의 실행 중 backend 계열 컨테이너는 1개였다. 컨테이너와 이미지 OCI revision 모두 v0.24.30 SHA였고 tag가 가리키는 image ID도 일치했다. pre-prepare 실행 인스턴스 0, healthy=true, restart 0.
- 컨테이너 교체 시각은 2026-11-03T16:24:39.641460724Z다. 그 이후부터 16:30:27Z 점검까지 보존된 로그 232줄의 error 패턴 및 qualified legacy-column 참조는 각각 0이었다. 원문 로그나 사용자 행은 외부로 출력하지 않았다.
- 실제 GET smoke: 내부 `/` 404, 공개 `/` 200, 내부·공개 health 200, 공개 submission-files 두 대소문자 경로 404, 파일 단건 익명 조회 401. 모두 기대값과 같았고 `EXIT=0`.
- 배포 smoke에는 POST probe도 있으므로 이 작업에서는 전체 smoke 스크립트를 재실행하지 않았다. 배포 당시 성공 영수증을 확인하고 현재 검증은 GET 부분만 수행했다.

재개 후 새 버전 identity 추가 확인에서는 v0.24.31/adc22bd, 실행 backend 1개, pre-prepare 0개였다. 보관된 이전 이미지와 실행 중 인스턴스를 혼동하지 않는다.

새 버전이 실제로 배포된 것이 확인되어 v0.24.30 점검을 반복하는 대신 v0.24.31의 바뀐 health/log 창만 추가 확인했다. 교체 시각 2026-11-03T16:44:32.905569288Z, healthy=true, restart 0, 보존 로그 504줄에서 error와 legacy-column 참조 각각 0, 공개 health 200, `EXIT=0`이었다.

## 자동 백업과 이전 복구 구성

v0.24.30 배포 #9235에서 만든 SQL 백업은 3,644,081 bytes, 수정 시각 2026-11-03T16:22:23.472Z였다. 객체 백업 영수증은 96 objects / 69,089,056 bytes다. 둘 다 앱 교체 전 생성된 해당 배포의 백업이며, 내용을 다운로드하지 않았다.

동일 실행의 PREVIOUS_STATE와 key identity를 읽어 이전 v0.24.29/fe00e178f compose, 이미지, 키 identity 캡처를 확인했다. 이전 compose에는 legacy secret 전달 항목이 있었다. 이는 v0.24.30 배포 당시 확인한 복구 자료이며 이후 이미지 보존 상태를 같은 것으로 단정하지 않는다.

이 백업은 **prepare 전** 백업이다. retire 직전의 최신 준비 상태를 백업한 것은 아니다. #1719 실행 때는 별도의 fresh retained backup과 owner 승인이 필요하다. 이번 작업은 백업을 생성하거나 복원하지 않았다.

## Frontend 배포와 실제 읽기

v0.24.30 Actions run 41673237211, job 126046862430의 Vercel 배포 step은 SUCCESS였고 2026-11-03T16:24:50Z에 완료됐다.

불변 배포 URL은 익명 접근 시 Vercel 로그인으로 이동했다. 이를 성공한 앱 응답으로 취급하지 않았다. 이미 로그인된 Vercel의 Production Deployment 화면에서 Ready, `jnu-oss-hub.com` alias, Source `4aa54c6`, Actions가 반환한 동일 deployment를 직접 확인했다. 배포 설정은 변경하지 않았다.

재개 후에는 같은 production 화면이 v0.24.31의 Source `adc22bd`를 표시했다. 해당 release run 41676325637도 SUCCESS였다. backend와 프로그램 읽기 계약은 prepare와 같다.

실제 `https://jnu-oss-hub.com`의 HTML/JavaScript를 브라우저에서 로드했다. 로컬 앱 서버는 사용하지 않았다. 빈 브라우저 세션에서 API는 합성 fixture로만 응답했고 미등록 API는 실패 처리했다. 외부로 나가는 GET/HEAD 이외 요청을 차단하고 service worker도 차단했다.

| 화면/계약 | 1440×900 | 390×844 |
| --- | --- | --- |
| 프로그램 목록에서 상세 링크 이동, 개요·모집 상태 표시 | PASS | PASS |
| 학생 팀의 신청 상태·팀원·신청서 링크 | PASS | PASS |
| RETRYABLE_FAILED → 재시도 대기 | PASS | PASS |
| FAILED_RETRYABLE → 재시도 대기 | PASS | PASS |
| FAILED → 생성 실패 | PASS | PASS |
| FAILED_FINAL → 생성 실패 | PASS | PASS |

기존 학생/재시도 시나리오 4개가 통과했고, 목록·상세와 최종 실패 상태의 추가 6개도 통과했다. 14개 캡처를 직접 확인했다. 추가 harness의 최초 실패는 모집 배지가 포함된 heading 이름과 누락된 application GET fixture였으며 제품 변경 없이 보완했다. 테스트 선택이 0건이었던 호출도 성공으로 세지 않았다. 통과한 4개를 반복하지 않고 나머지 6개만 재실행하여 `6 passed`, `EXIT=0`을 확보했다.

이는 운영 번들의 읽기·표시 검증이며 운영 사용자 권한으로 쓰기 기능을 수행한 증거가 아니다.

## Live 제약과 정확한 행 수

READ ONLY 연결과 트랜잭션 모두 on, `EXIT=0`.

| 테이블 | 행 수 |
| --- | ---: |
| Program | 10 |
| Milestone | 20 |
| SubmissionFile | 81 |
| MilestoneDocumentTemplateFile | 5 |
| Team | 40 |
| TeamMember | 72 |
| TeamInvitation | 28 |

- migration 85개 완료, 미완료 0. prepare 완료 및 checksum 일치, retire 적용 0.
- 물리 PK는 아직 `(id)`. `(teamId,userId)` UNIQUE는 valid/ready, 중복·NULL 키 0, incoming FK 0이다.
- 두 storageKey UNIQUE 인덱스는 unique/valid/ready다.
- 명시적 날짜 CHECK 2개 validated, legacy trigger 0, 새 Milestone boundary trigger 1개 enabled.
- sentinel 시작일·프로그램 기간 밖 milestone 각각 0.
- 옛 여섯 컬럼은 아직 존재한다. 초대 invitedAt/createdAt 불일치 0이다.

## 쓰기 관측 범위

교체 시각 이후 createdAt을 가진 Team, TeamMember, TeamInvitation은 각각 0건이었다. TeamMember 누적 update counter도 0이었다. 하지만 table 통계는 컬럼별·교체 이후 전용 감사 자료가 아니다.

`log_statement=none`, pg_stat_statements 미설치, 해당 세 테이블의 사용자 audit trigger 0이다. 따라서 **모든 명시적 legacy-column UPDATE의 부재를 증명할 수는 없다.** 로그에 참조가 없었다는 사실을 SQL 감사로 과장하지 않는다.

또한 호환 기간의 id/joinCodeDigest UUID 기본값과 invitedAt CURRENT_TIMESTAMP는 여전히 존재한다. 새 INSERT가 생기면 앱이 컬럼을 지정하지 않아도 DB가 값을 채울 수 있다. 이것을 옛 앱이 명시적으로 쓴 것과 구분해야 한다. 감사 기능을 새로 설치하거나 운영 데이터를 바꾸지는 않았다.

## #1719가 비가역적으로 제거하는 것

| 삭제 컬럼 | 현재 non-NULL 값 개수 | 영향 |
| --- | ---: | --- |
| TeamMember.id | 72 | 옛 surrogate ID 값과 id PK/index 제거 |
| TeamMember.name | 0 | 중복 이름 snapshot 컬럼 제거 |
| TeamMember.email | 0 | 중복 이메일 snapshot 컬럼 제거 |
| TeamMember.department | 0 | 중복 소속 snapshot 컬럼 제거 |
| Team.joinCodeDigest | 40 | 사용 중단한 digest 값 제거 |
| TeamInvitation.invitedAt | 28 | legacy timestamp 컬럼 제거; 현재 28건은 createdAt에 동일하게 보존 |

행 삭제가 아니라 컬럼 값·저장 구조 삭제다. 기존 복합 UNIQUE를 `(teamId,userId)` PK로 승격하며 programId 복합 FK와 `(programId,userId)` UNIQUE는 유지한다. SQL은 트랜잭션과 제한 시간을 사용하고 incoming FK를 잠금 안에서 재확인한다. CASCADE는 사용하지 않는다.

삭제 후 옛 id/digest를 ADD COLUMN만으로 원래 값으로 복구할 수 없다. 데이터 복구에는 백업과 별도 판단이 필요하다. 앱 rollback은 prepare-compatible v0.24.30/31까지 가능하고 pre-prepare v0.24.29로의 단순 앱 rollback은 금지한다.

backend 응답은 RETRYABLE_FAILED/FAILED 별칭 대신 FAILED_RETRYABLE/FAILED_FINAL을 반환하고, 아카이브 내부 SUBMITTED→PENDING 변환을 없앤다. 이 코드 변경은 데이터 DROP과 별개이며 frontend 입력 경계는 구·신 값을 계속 수용한다.

## 브랜치 갱신과 로컬 검증

main `103c107ddf6f6ea19fcc14de95d43aac6f3b8c8a`를 병합했다. prepare 문서·이관 도구·가이드 변경을 보존했다. 최신 main 대비 원래 retire 변경은 18개 파일이며, 이 증거 문서가 추가된다. 무관한 삭제는 없다.

v0.24.30과 직접 비교할 때 추가로 보이는 8개 파일은 main에서 이미 반영된 차트 focus 설정·가이드 변경이다. #1719가 새로 제안하는 제품 변경과 구분했다. backend/migration의 추가 변경은 기존 retire 내용뿐이다.

prepare SQL SHA-256: `a381db6f234a508f45f6478f4cbec54e4046795fae3e52764bb363a8e1340c0a`.
retire SQL SHA-256: `e83390b7d6cc95c20a37b79515cc161beb706b97f9dd37d749f633a7c6102fb8`.
둘 다 수정하지 않았다. 기존 승인된 복원 리허설과 같은 SQL이다.

| 실행 | 결과 | EXIT |
| --- | --- | ---: |
| 지정 schema-invariants / team-invitations / program-teams 통합 | 3 suites / 16 tests PASS | 0 |
| backend / frontend typecheck | 각각 실행 | 각각 0 |
| backend / frontend lint | 오류 없음 | 각각 0 |
| lint:structure / format:check | 순차 실행 | 각각 0 |
| 파일 원장 | 257 paths | 0 |

기존 frontend anchor 경고 4개, backend boundaries 설정 deprecation 및 원장 Node module-type 경고는 남겼다. 테스트를 삭제·약화하거나 경고를 숨기지 않았다.

운영 DDL은 실행하지 않았다. owner의 비가역 삭제 승인과 실행 직전 사전 점검·fresh backup이 남아 있으므로 draft를 유지한다.
