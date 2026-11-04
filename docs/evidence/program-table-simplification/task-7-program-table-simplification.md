# Todo 7: 등록된 팀 저장소로 수집 범위 제한

## 배포 순서

준비 릴리스는 조직 설치 목록에서 레포를 자동 등록하는 경로를 없애고, 이미 연결된 조직·외부 레포의 메타데이터와 기여만 수집한다. 팀 삭제와 URL 교체는 OSS Hub의 레포 행과 수집 기록을 삭제한다. GitHub 원본 레포를 삭제하는 API는 호출하지 않는다.

선행 frontend PR #1730은 팀 삭제만 안내하고 저장소 행·수집 기록의 보존이나 삭제를 약속하지 않는다. 이 중립 안내가 운영에 반영된 뒤 backend 전용 준비 PR #1726을 배포한다. 기존 backend에서 행·fact가 보존되든 새 backend에서 삭제되든 중립 문구는 사실이다.

정확한 저장소 삭제 안내와 guide는 준비 backend가 운영에서 검증된 뒤 별도 frontend draft로 적용한다. 이 backend PR은 #1730을 기준으로 `apps/frontend/`와 `guide/` diff가 없다. 앞선 게이트가 지적한 “삭제 안내 frontend 먼저” 순서만으로는 기존 backend와의 불일치를 해결할 수 없었으므로 사용하지 않는다.

다음 릴리스의 별도 마이그레이션이 승인된 12개 레포를 정리하고 `Application.teamId`를 백필한 뒤 `GithubRepository.teamId` 부분 유니크를 추가한다. 마이그레이션은 앱 교체보다 먼저 실행되므로, 두 릴리스를 합치면 옛 조직 인벤토리가 삭제한 행을 다시 만들 수 있다. 준비 코드를 먼저 배포해야 한다.

다른 단위가 소유한 프로그램 물리 purge의 연결 해제 경로도 남지 않아야 하므로 Todo 5의 purge 중단 준비 릴리스를 데이터 정리 전에 배포한다. `public-projects.repository.ts`와 `program-lifecycle.config.ts`는 이 단위에서 수정하지 않았다.

`applicationId`와 `programId` 컬럼 제거는 Todo 9의 Application 전환 소유다. 이번 단계에서는 삭제하지 않는다. 팀 삭제 응답의 `detachedRepositories` 키는 wire 호환을 위해 유지한다. 중립 frontend는 그 값을 저장소 처리 약속으로 표시하지 않고, 정확한 “저장소 등록 삭제” 표시는 후속 frontend에 둔다.

## 운영 읽기 전용 재집계

2026-11-04 03:15:25 UTC, `REPEATABLE READ READ ONLY`, `transaction_read_only=on`, `EXIT=0`.

| 대상                                 | 승인된 삭제 행 |
| ------------------------------------ | -------------: |
| GithubRepository                     |             12 |
| CollectionCommitFact                 |            167 |
| Contribution                         |             25 |
| CollectionRepositoryStream           |             40 |
| CollectionPullRequestFact            |             15 |
| CollectionReleaseFact                |              9 |
| GithubRepositoryOutsiderContribution |              1 |
| RepositoryInvitation                 |              9 |
| CollectionRepositoryYearAggregate    |              1 |
| CollectionContributorYearAggregate   |              2 |

레포 12행과 직접 종속 269행, 합계 281행이다. 전체 레포는 19행이며 조직 레포 10행과 외부 레포 2행이 삭제 대상이다. 대상의 공개 프로젝트 노출, 지원 연결, 프로그램 연결은 모두 0건이다. teamId 백필 대상, 지원·레포 팀 불일치, 팀별 중복 그룹도 모두 0건이다.

대상 Issue, provision job, issuance history, outbox 직접 참조, notification 직접 참조, cursor 참조는 각각 0건이다. 대상 REPOSITORY AuditLog 1행은 삭제하지 않고 Todo 10에 남긴다. 마이그레이션은 대상 테이블을 잠근 후 승인 건수를 다시 세며 하나라도 달라지면 전체 트랜잭션을 중단한다. 마이그레이션 기록 외의 모든 애플리케이션 테이블이 빈 DB만 데이터 삭제 없이 제약을 적용한다. 사용자나 활동 캐시가 있는데 레포만 0개라면 승인 건수 불일치로 중단한다.

## 레거시 연간 집계

`20260731150000_add_collection_incremental_schema`가 레포별 연간 집계와 기여자별 연간 집계를 만들었다. 이후 레포 통합 마이그레이션에서 FK의 참조 대상은 현재 GithubRepository로 이어진다. 현재 Prisma 모델과 제품 읽기 경로에는 두 모델이 없다. 기존 검색 결과는 생성 마이그레이션과 과거 마이그레이션 테스트뿐이었다.

운영의 두 FK는 모두 `ON DELETE CASCADE`다. 따라서 승인 대상 레포를 삭제하면 연결된 1행·2행만 지워지고 무관한 행은 남는다. 테이블을 DROP하거나 Prisma 모델에 다시 추가하지 않는다. 새 교체 삭제 도우미는 감사 기록의 정확한 삭제 건수에 이 행들을 포함한다. 두 테이블의 최종 폐기와 이 계측 제거는 별도 후속 작업이다.

## URL 교체와 이력

교체 트랜잭션은 옛 연결의 유니크 슬롯을 해제하고 새 레포를 연결한 뒤 옛 레포와 수집 기록을 삭제한다. 레포 초대의 RESTRICT FK는 명시적으로 정리한다. 발급 job은 새 레포로 갱신하며 남은 옛 레포 참조는 명시적으로 해제한다. RepositoryIssuanceHistory는 값 참조 이력이므로 보존한다.

같은 URL 재등록과 같은 GitHub 레포의 이름 변경은 기존 레포와 수집 기록을 유지한다. 감사 기록 실패 또는 새 레포 연결 실패 시 옛 연결과 수집 기록도 함께 롤백된다. 옛 발급 요청에 행위자가 없으면 기존 레포 교체에 한해 `INVALID_EVENT`로 중단하고 옛 연결을 보존한다. 이력을 위한 행위자를 추정하지 않는다.

TeamHistory가 아직 없으므로 경쟁 테이블을 만들지 않는다. 수동 교체의 `APPLICATION_REPOSITORY_URL_CHANGED` schemaVersion 2에 기존 `before.repositoryUrl`과 선택적 `deletedCounts`를 함께 저장한다. 발급 경로 교체의 `REPOSITORY_CONNECTION_CHANGED`에는 `deletedRepositoryUrl`과 `deletedCounts`를 저장한다. Todo 8/9에서 해당 사실과 행위자를 TeamHistory로 옮기고 쓰기를 전환해야 한다. 기존 화면용 AuditLog parser는 추가 필드를 반환하지 않으므로, 이관 시 원본 metadata의 삭제 URL·건수를 보존해야 한다.

현재 Program에는 별도의 “레포 제출 필수” 설정이 없다. `repositoryProvisioningEnabled`는 자동 발급 기능 설정이다. OWN 방식은 승인 시 유효 URL이 필요하고, URL 수정 DTO는 빈 문자열과 null을 거부한다. 소유자의 추가 답변이 없으므로 오케스트레이터 기본 판단에 따라 이 PR에서 새 설정이나 삭제 API를 만들지 않는다. 필수 설정의 도입 여부는 후속 결정으로 남긴다. 교체는 새 연결과 옛 연결 삭제를 같은 트랜잭션으로 처리하므로 연결된 팀을 빈 상태로 남기지 않으며, 기존 조직 밖 공개 레포 허용·동의 규칙은 유지한다.

## 서버 내부 복원 리허설

공식 `deploy/jenkins/program-migration/rehearse.sh`로 운영 덤프를 같은 서버의 임시 PostgreSQL에 복원했다. 운영 DB에는 읽기 전용 집계와 pg_dump만 실행했다. 원본 데이터는 서버 밖으로 내보내지 않았다.

- 최종 리허설 사전 가용 디스크: 61,075,337,216 bytes. 덤프: 3,631,092 bytes.
- PostgreSQL: network none, published ports 0, CPU 0.5, memory와 memory+swap 각 512 MiB, rehearsal label, nice 19. 데이터 디렉터리는 512 MiB tmpfs, AutoRemove는 true다.
- Docker inspect에서 PostgreSQL의 volume 마운트 이름은 빈 값이고 랭킹 실행 이미지의 volume 선언 수도 0이었다. 랭킹 컨테이너도 `--rm`과 nice 19를 사용한다.
- 마이그레이션 SHA-256: `d41d67ecbe46a474bb07cc6ef86fb20bd23669c47cbfd7ae3b09a7b7ad187294`.
- preflight, 삭제 후 대조, 17개 테이블 백업 복원 비교: 모두 통과, `REHEARSAL_OK`, `EXIT=0`.
- 레거시 연간 집계의 전체 행은 2→1, 6→4로 바뀌며 테이블과 무관한 행은 보존됐다. AuditLog 371행은 그대로다.

별도 복원 DB에서 실제 배포 이미지의 RankingRepository·RankingService를 실행해 삭제 전후 응답을 비교했다. 공개·회원·교직원과 전체·저장된 연도의 6개 페이지 경우, 906개 랭킹 항목, 월별 행 1,731개를 비교했으며 차이는 0이다. 항목 값·순위·이전 순위·표시 정보·dataAsOf를 포함하며 시계에서 계산하는 nextCycleAt만 비교에서 제외했다.

전후 SHA-256은 모두 `98ddb8609fd3f02aa39fc8fa678d96436c611b67b87ec8f78fb95fb7127d7eb4`다. 랭킹은 GithubUserActivity 계열을 읽으므로 옛 레포의 Collection fact·Contribution 삭제와 분리된다. 교체 삭제도 이 계열에 쓰지 않는다. 성능 개선은 측정하거나 주장하지 않는다.

리허설과 랭킹 실행 컨테이너, 덤프, 개인정보가 포함될 수 있는 비교 JSON, 서버 임시 디렉터리는 모두 제거했고 `CLEANUP_OK containers=0 dump=absent private_directory=absent`를 확인했다.

최종 리허설은 익명 볼륨을 만들지 않았으며 `VOLUME_CLEANUP_OK postgres_volume_mounts=0 data_mount=tmpfs`를 확인했다. 앞선 실행도 wrapper의 `docker rm -f -v`로 정리했지만 당시 볼륨 이름은 별도 기록하지 않았고 그 Docker 이벤트는 보존 범위에 남지 않았다. 다른 단위 소유로 확인된 볼륨은 마운트·삭제하지 않았으며 prune을 실행하지 않았다.

## 검증 기록

아래는 최초 통합 head `e337dce1b`와 retire 후보를 함께 검증한 기록이다. 현재 backend 전용 PR의 exact-head 실행과 구별한다. 당시 화면 캡처의 정확한 삭제 안내는 후속 frontend draft로 이동했으며, 운영 선행 화면은 #1730의 중립 안내다.

- 조직 설치 목록의 미등록 레포가 생성되는 기존 구현에서 새 회귀 테스트가 실패했다.
- 팀 삭제가 레포·기여를 남기던 기존 구현에서 실 DB 회귀 테스트가 실패했다.
- 교체 삭제를 누락하는 변이를 넣으면 옛 레포 잔존으로 회귀 테스트가 실패했다. 삭제 구현을 복원했다.
- 승인 범위 각 테이블의 건수 변동, 빈 DB, 부분 유니크, 무관한 레코드·감사·랭킹 보존을 실제 PostgreSQL에서 검사했다.
- 부분 유니크가 실제로 존재하는 DB에서 URL 교체·실패 롤백·같은 URL 재등록·같은 GitHub ID의 이름 변경 14개 테스트가 통과했다. 별도 격리 DB에서 동일 스펙 14개를 다시 실행한 flaky probe도 통과했다.
- 공유 삭제 repository는 기존 공용 ORM 경계에만 등록했다. service·controller 직접 호출과 일반 타 도메인 repository 접근 금지 회귀는 유지한다.
- backend 전체 단위 테스트: 390 suites, 6,337 tests, `EXIT=0`.
- backend 전체 통합 테스트: 143 suites, 1,016 tests, `EXIT=0`. 데이터 삭제 마이그레이션 후보의 14개 회귀도 포함한 결과이며, 해당 SQL과 회귀 파일은 별도 retire PR에 함께 전달한다.
- frontend 전체 테스트: 439 files 통과. 보존된 Vitest 결과 캐시에서 실패 파일 0건을 확인했다.
- 변경된 frontend 테스트: 3 files, 53 tests, `EXIT=0`.
- frontend·backend CI 빌드, 디자인 동기화 계약과 통합 실행기 계약 검사: `EXIT=0`.
- 브라우저 회귀: desktop·mobile × 밝은·어두운 OS 선호 4개 경우, `EXIT=0`.
- 실제 프론트엔드와 합성 API 응답으로 삭제 대화상자의 Before/After를 1440×900·390×844에서 각각 확인했다. 밝은·어두운 OS 선호 모두 기존 제품의 밝은 테마로 렌더된다. 레이아웃을 바꾸지 않았으며 원본 GitHub 레포와 OSS Hub 등록 정보의 차이를 명시했다.
- DOM 점검에서 중복 사실과 한 문장 내 숫자 반복은 0건이고 상태 선택 그룹은 없었다. 두 버튼은 각각 77.65625×44 CSS px였다.

양쪽 lint·typecheck, structure, format, 파일 원장은 `EXIT=0`이다. frontend lint에는 변경하지 않은 테스트의 `<a>` 링크 경고 4건이 있다. 기존 boundaries 설정의 mode 폐기 예정 알림과 파일 원장 실행의 Node 모듈 타입 알림도 숨기지 않았다. 공개 안전 검사와 PR 주소는 최종 전달에 기록한다. 운영 데이터 삭제·머지·릴리스는 수행하지 않았다.

## 게이트 B1 수정과 URL 교체 랭킹 실측

선행 PR #1730은 중립 안내와 그 가이드 증거를 담당한다. 기존 backend의 실제 팀 삭제 통합 20개 테스트, 중립 UI 54개 테스트, desktop·mobile 브라우저 4개 경우가 통과했다. UI의 저장소 결과 약속을 제거하고 동일한 API 응답을 처리하므로 기존·후속 backend 어느 쪽과도 안내가 모순되지 않는다. 서로 다른 backend 두 개를 브라우저에 연결한 E2E로 보고하지 않으며 backend DB 계약과 frontend 동작을 각각 검증했다.

`student-repository-url.ranking.integration.spec.ts`는 실제 `StudentRepositoryUrlService.updateMine`을 실행한다. 이전 레포·Contribution의 삭제와 새 연결을 확인한 뒤 실제 RankingService·RankingRepository의 공개·회원·교직원 × 현재 연도·전체 기간 6개 응답을 교체 전 값과 비교한다. 현재 활동의 공개·비공개 값, 이전 주기 순위, 교직원 이름 표시, 월별 값이 있는 fixture를 사용하며 빈 결과끼리 비교하지 않는다. 시계에서만 계산하는 `nextCycleAt`을 제외한 응답과 월별 값은 같았다. 최초 직접 비교는 1 suite·1 test, EXIT=0이며 제품 코드에서 랭킹 값 변화는 없었다.

회귀 검증용으로 삭제 repository가 옛 레포 기여자의 `GithubUserActivityHistory`까지 지우는 변이를 잠시 넣었다. 실제 응답의 연간 total 33·전체 total 39가 0으로 바뀌며 새 테스트가 실패했고, 의도한 실패 EXIT=1을 확인했다. 변이는 원본 바이트로 복원했다. 이 변화는 제품에서 발견된 랭킹 회귀가 아니라 테스트가 잘못된 삭제를 잡는다는 증거다.

`program-team-repository-evidence`와 `program-team-activity`의 두 테스트 이름은 현재 연결 레포와 무관한 레포의 읽기 격리를 설명하도록 고쳤다. 기존 기대값은 유지하며 교체 후 옛 fact 보존을 약속하지 않는다.

세 변경 파일만 지정한 공식 통합 실행은 3 suites·12 tests, EXIT=0이다. 전체 통합·단위 재실행은 최신 속도 지시에 따라 중단했으며 완료 검증으로 세지 않는다. 중단한 실행의 자체 컨테이너·볼륨·네트워크도 제거했다.
