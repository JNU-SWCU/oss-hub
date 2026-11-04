# Todo 8 3a: 새 초대 종료 이력

## 범위와 배포 순서

3a → 3a 운영 확인 후 3b → 별도 승인한 물리 DROP 순서다. 이번 변경은 3a뿐이다. 기존 종료 초대의 이관·삭제, status 제거, Preparation 테이블 DROP은 포함하지 않는다. 시작 main은 `e40766704`다.

TeamHistory는 teamId, programId, actorId, event, occurredAt, recordedAt, source와 data를 갖는다. 팀·프로그램·행위자 ID는 역사적 스냅샷이며 팀 삭제에 cascade하지 않는다. 현재 사건은 INVITATION_ACCEPTED, INVITATION_DECLINED, INVITATION_CANCELLED다. data.schemaVersion은 1이고 초대 ID·대상·초대자·생성 시각을 보존한다. 다른 팀에 합류하며 닫히는 초대는 CANCELLED와 JOINED_ANOTHER_TEAM 사유를 기록한다. sourceTable/sourceId 유니크가 동일 초대의 중복 종료 이력을 막는다.

종료는 권한·대기 상태를 확인한 뒤 조건부 삭제와 이력 INSERT를 같은 트랜잭션에 둔다. 수락의 구성원 생성, 저장소 권한 동기화 outbox, 감사 기록도 같은 커밋이다. 이력 INSERT 실패와 후속 감사 실패가 삭제·가입을 모두 되돌린다. 기존 Program → Team → User 잠금 순서와 삭제된 프로그램의 쓰기 거부를 유지한다.

기존 종료 초대와 구 앱이 추가한 종료 행은 그대로 두되 송신·수신 목록은 PENDING만 읽는다. status, respondedAt, enum과 기본값은 유지한다. 응답의 status=PENDING, respondedAt=null, invitedAt 필드도 유지하여 구 프론트가 그대로 처리한다.

## Preparation과 배포 전제

Preparation 저장소, mutation 경로, 신청 전환·검색·수락·등록 초기화·삭제 지문의 테이블 접근을 중단한다. 구 프론트가 팀이 없을 때 호출하는 보호 GET `/api/v1/application-preparations/programs/:programId/me`는 활성 학생에게 `{"membership":"NONE"}`을 반환한다. 이전 mutation·검색·송신 목록 9개 경로는 404다. 물리 테이블과 FK, 사용하지 않는 이전 DTO 선언은 남는다.

기존 Preparation 생성·수락·최종 제출·상호 배제 테스트는 폐기한 API 계약을 검증하므로 제거했다. 대체 증거는 기존 신청·지명·최소 인원·수락 경합 테스트, 실제 HTTP의 구 GET 응답과 폐기 경로 9개, Preparation 두 테이블 각각의 비어 있지 않은 migration 거부 테스트다. 실패를 숨기기 위한 skip이나 기대값 완화는 없다.

migration은 Preparation 중 하나라도 비어 있지 않으면 DDL 전에 실패한다. 다만 migration은 구 앱이 살아 있는 동안 실행된다. **migration 시점의 0건만으로 이후 구 앱의 쓰기가 없음을 보장하지 않는다.** 배포 담당자는 기존 Preparation 요청을 끝내고 구 backend writer를 종료한 뒤 같은 preflight를 다시 확인해야 한다. 늦은 행이 있으면 3a 활성화를 중단하고 기존 앱으로 보존·처리한다. 임시 trigger나 운영 데이터 삭제는 추가하지 않았다.

롤백 중에는 구 앱이 Preparation을 다시 만들 수 있다. 3a migration은 이미 적용됐으므로 재배포 시 자동으로 재실행되지 않는다. 따라서 3a를 다시 활성화할 때도 `migration-checks/team-history/preflight.sql`을 별도로 실행해야 한다. 이 전제를 자동 배포가 충족했다고 주장하지 않는다.

## 운영 읽기 전용 집계

2026-11-04의 읽기 전용 집계는 EXIT=0이다.

| 항목                       | 건수 |
| -------------------------- | ---: |
| Preparation                |    0 |
| PreparationParticipant     |    0 |
| PENDING 초대               |    3 |
| ACCEPTED 초대              |   20 |
| DECLINED 초대              |    5 |
| 팀이 없는 종료 초대        |    0 |
| 응답 시각이 없는 종료 초대 |    0 |
| 응답 시각이 있는 대기 초대 |    0 |
| 중복 대기 초대 그룹        |    0 |

이번 migration의 기존 행 이관·삭제는 각각 0건이다. 종료 25건은 후속 3b 대상으로 보존한다. 실제 3b 실행 전에 다시 집계해야 한다.

## 운영 서버 내부 리허설

운영에는 읽기 전용 dump만 수행했다. dump와 복원 데이터는 운영 서버 안에만 두었다. 공식 `deploy/jenkins/program-migration/rehearse.sh`로 baseline → prepare → 대조 → 별도 DB 백업 복원을 실행했다. 기준 migration은 `20261104130000_retire_teamless_github_repositories`다.

- SQL SHA-256: `668e6260dcc0c176003c8897fe6e65b2e9a347e534feee187b0bf1a4212ec286`.
- 시작 /tmp 여유 8,033,708 KiB, dump 3,590,252 bytes.
- 운영 PostgreSQL 17 이미지 재사용, network none, 공개 포트 없음, CPU 0.5, 메모리·swap 합계 512 MiB, 데이터 디렉터리 tmpfs 256 MiB, nice 19.
- 원본 초대와 구성원의 전체 행 JSON digest가 prepare 전후 동일했다. TeamHistory는 0건이며 기존 종료 초대는 이동하지 않았다.

| 백업 전 / 복원 후 |  전 |  후 |
| ----------------- | --: | --: |
| 초대              |  28 |  28 |
| 구성원            |  72 |  72 |
| Preparation 합계  |   0 |   0 |

```text
REHEARSAL_OK name=team-history-3a stages=2 counts=3
CLEANUP containers=0 private_directories=0 EXIT=0
SOURCE_CLEANUP=0
STAGE3A_SERVER_EXIT=0
```

컨테이너는 --rm 및 docker rm -fv, 데이터는 tmpfs를 사용했다. dump·백업·임시 DB·소스 디렉터리를 정리했다. 이 리허설 백업을 실제 배포용 보존 백업으로 주장하지 않는다.

## v0.24.36 롤백 증거와 한계

실제 태그 `8e7edf3a9bece95d54ef6da9f533ec04c934a2d5`에서 초대 repository 소스를 추출해 새 schema에 실행했다. 소스 blob은 `8457ee34949ab778a0a8965916c84fce065312b8`이다. 생성한 임시 fixture는 검증 후 제거했다.

- 3a 수락·거절·취소 뒤 구 앱 송신·수신 조회가 정상 반환한다.
- 이미 삭제된 ID의 구 앱 수락·거절·취소 재시도는 not-found다. 과거 status 변경 방식의 not-pending과 오류 종류가 다르며, 이력을 초대로 복구하지 않는다.
- 3a 수락으로 생성한 TeamMember는 롤백 뒤에도 그대로 남는다.
- 3a 거절 후 구 앱이 재초대하고 ACCEPTED/DECLINED를 기록하는 세 경로가 동작한다. 새 앱으로 다시 읽으면 해당 종료 행은 목록에서 제외한다.
- 이 여섯 시나리오와 삭제 프로그램 쓰기 경계 재검증 51개가 함께 통과했다. `STAGE3A_ROLLBACK_EXIT=0`.

이는 실제 구 repository 코드와 현재 생성 Prisma Client로 확인한 도메인 호환 증거다. v0.24.36 전체 컨테이너 이미지의 부팅·전체 앱 회귀를 실행한 것은 아니다. 구 앱은 TeamHistory를 조회하거나 새 이력을 기록하지 않으며, 롤백 중 생성되는 종료 행은 이후 3b가 이관해야 한다. 다른 병합 작업의 전체 이미지 롤백 호환까지 보장하지 않는다.

## 소비 화면

프론트 제품 코드는 바꾸지 않았다. 운영 번들을 headless Chrome으로 열고 API만 합성 응답으로 가로챘다. Before는 legacy 종료 행과 PENDING을 함께 반환하고, After는 PENDING만 반환한다. 같은 학생·팀·고정 시각에서 목록에 대기 초대가 한 개만 나타나고 취소 후 사라지는 동작을 1440×1000과 390×844에서 확인했다. 종료 행을 이미 필터하던 화면이어서 모습은 같다.

첫 하네스 실행은 개요 API와 동의 필수 항목이 빠져 실패했다. 실제 계약을 읽고 두 응답을 고쳤으며, 최종 네 시나리오가 통과했다. 모바일은 내부 스크롤 때문에 취소 버튼이 캡처 밖에 있어 컨트롤을 중앙으로 이동한 두 캡처를 추가로 만들었다. 스크린샷은 실제 Chrome 출력이고 합성 이미지로 고치지 않았다. 대기·취소 후 여덟 장을 직접 확인했으며 PNG 텍스트·EXIF 메타데이터는 없다.

서버는 띄우지 않았고 page.route가 모든 API 요청을 가로채므로 운영 쓰기는 없다. 화면 증거는 소비 호환만 증명한다. 이력 저장과 트랜잭션은 별도 실제 PostgreSQL 테스트와 서버 내부 리허설로 검증했다. 안내 문구·제품 화면이 같아 guide 갱신은 없다.

## 실행 영수증과 검토

| 검사                                        | 결과                                     |
| ------------------------------------------- | ---------------------------------------- |
| 초대·신청·호환 HTTP·등록 초기화·라우트 단위 | 12 suites / 196 tests 통과               |
| 관련 DB 통합                                | 11 suites / 172개 고유 테스트 최종 통과  |
| migration 경계                              | 1 suite / 4 tests 통과                   |
| v0.24.36 실제 repository                    | 6개 rollback 시나리오 통과               |
| 소비 화면                                   | 4개 시나리오와 최종 모바일 캡처 2개 통과 |
| backend / frontend typecheck                | 각각 EXIT=0                              |
| knip / 파일 원장                            | EXIT=0 / FILE_LEDGER_OK 259 paths        |

관련 DB 통합의 최초 최종 묶음은 171 passed / 1 failed였다. 실패는 동시 수락·제외 테스트가 삭제된 초대를 findUniqueOrThrow로 읽던 이전 저장 계약이었다. 가입·리더·지원서·제출 보존 단언을 유지하고 초대 부재와 ACCEPTED 이력 단언으로 바꾼 뒤 해당 suite 19개를 다시 통과했다. 앞선 삭제 경계 fixture에는 새 이력 정리를 추가하여 테스트 ID 재사용 충돌을 해결했다.

이력 INSERT의 P2002가 기존 가입 충돌 catch에 잡히는 문제는 실패 테스트로 재현했다. TeamMember 충돌만 가입 충돌로 바꾸며 이력 실패는 전파하고 트랜잭션을 롤백한다. 서비스의 직접 Prisma 접근과 static repository는 저장소 lint 규칙에 맞춰 기존 학생 조회 repository와 명시적인 TeamHistoryRepository 생성자 주입으로 바꿨다. 관련 테스트 생성 지점도 같은 의존성을 주입한다. 오류 억제·검사 제외는 추가하지 않았다.

변경 파일 lint는 커밋 훅에서 수행한다. 전체 test suite, 새 build, 독립 gate 승인은 이 worker에서 실행하지 않았다. root의 최종 gate·merge·release 대상으로 인계한다. 이력 수집·Preparation 중단과 무관한 서비스 통합, 추가 파일 분리, UI 개선은 하지 않았다.
