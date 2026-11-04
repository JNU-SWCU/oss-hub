# Todo 7: 팀 없는 저장소 데이터 정리

준비 PR #1726은 main에 반영됐다. 이 retire PR은 최신 main `8261fc711d835688f69d636a7660e7de9f71f424`를 이력 재작성 없이 병합한 별도 draft이며 운영 반영을 승인하거나 실행하지 않는다.

2026-11-04 사용자가 v0.24.34 이상에서 옛 collector가 사라졌고 v0.24.38에 Todo 5 purge 중단이 반영됐다고 전달했다. 읽기 전용 운영 재집계의 레포 12·commit 167·PR 15·release 9·stream 40도 승인과 일치한다고 전달받았다. 이번 작업에서는 운영 DB를 다시 조회하거나 변경하지 않았다.

## 실행 순서

1. 선행 frontend #1730의 중립 팀 삭제 안내가 운영에 반영됐는지 확인한다. 저장소 행·fact의 보존이나 삭제를 약속하지 않는 전환 안내다.
2. 준비 백엔드를 배포해 조직 인벤토리 자동 등록과 늦은 enrollment 재생성을 중단한다.
3. Todo 5의 프로그램 purge 중단 코드가 운영에 반영됐는지 확인한다. 연결 해제만 하는 옛 purge가 남아 있으면 진행하지 않는다.
4. 다음 릴리스에서 새 백업과 읽기 전용 재집계를 수행한 뒤 이 데이터 마이그레이션을 적용한다.

준비 코드와 삭제 SQL을 같은 릴리스에 넣지 않는다. 배포 실행기는 마이그레이션을 앱 교체보다 먼저 적용한다.

## 승인 범위와 보존

`20261104130000_retire_teamless_github_repositories/migration.sql`은 승인된 레포 12행과 직접 종속 269행만 삭제한다. 각 테이블의 건수가 달라지면 어떤 행도 지우지 않고 중단한다. 팀 불일치도 중단하며, `Application.teamId` 백필 후 부분 유니크로 팀당 레포 0개 또는 1개를 보장한다.

SQL SHA-256은 `d41d67ecbe46a474bb07cc6ef86fb20bd23669c47cbfd7ae3b09a7b7ad187294`이며 서버 복원본에서 검증한 파일과 같다. 정확한 테이블별 건수와 서버 격리·복원·랭킹·정리 영수증은 [준비 단계 증거](task-7-program-table-simplification.md)에 있다.

병합한 main의 마지막 마이그레이션은 `20261104050000_prepare_program_absorption`이다. retire 폴더 `20261104130000_retire_teamless_github_repositories`가 이미 그 뒤에 정렬되므로 이름과 SQL 바이트를 바꾸지 않았다.

마이그레이션 기록 외의 애플리케이션 테이블이 모두 빈 신규 DB만 승인 건수 비교를 생략한다. 사용자나 활동 캐시가 있는데 레포만 없는 DB는 신규 설치가 아니므로 중단한다.

`RepositoryInvitation`은 RESTRICT FK이므로 먼저 삭제한다. 레거시 연간 집계 두 테이블은 현재 Prisma 모델에 없지만 기존 FK의 CASCADE로 대상 1행·2행만 삭제한다. 테이블 자체와 무관한 행은 유지한다. 대상 AuditLog 1행, 발급 값 이력, 사용자 활동 기반 랭킹은 보존한다. `applicationId`·`programId` 컬럼 제거와 TeamHistory 전환은 포함하지 않는다.

## 검증 경계

main `8261fc711` 병합 후 공식 실행기가 새 격리 DB에 88개 마이그레이션을 적용하고 retire·프로그램 흡수·수집 경계 타깃 11 suites·102 tests를 통과했다(EXIT=0). `20261104050000_prepare_program_absorption` 다음에 retire SQL이 적용됐다. 전체 스위트는 재실행하지 않았다.

Todo 5의 `PlatformRepository.collectionTargetWhere()`는 `applicationId != null`과 직접 연결·지원 연결 양쪽 프로그램의 `DELETED` 제외를 함께 적용한다. 조직·외부 목록과 실행 직전 재조회가 이 조건을 사용한다. `relink-collection.integration.spec.ts`의 두 source 경우에서 삭제된 프로그램은 수집·상태 집계에서 제외되고 기존 fact·랭킹은 유지됐다. 같은 팀에 두 번째 레포를 INSERT하면 `P2002`, `target: ['teamId']`로 실패하는 단언을 추가해 실제 전체 마이그레이션의 부분 유니크가 이 상태에서도 유지됨을 확인했다.

`github-scope-migration.integration.spec.ts`는 실제 SQL을 격리 스키마에 실행한다. 승인 범위 삭제·백필, 각 양수 삭제 건수의 변동 시 롤백, 완전히 빈 DB, 기존 사용자·활동이 있는 레포 0개 DB, 부분 유니크 위반을 검사한다. 운영 복원본에서는 실제 배포 이미지의 랭킹 결과와 17개 테이블 백업 복원을 별도로 대조했다.

이전 head `5e3e969c2`에서 공식 통합 실행기가 빈 DB에 87개 마이그레이션을 적용한 뒤 실행한 전체 통합 회귀는 143 suites·1,016 tests 모두 통과했다. 실제 `GithubRepository_teamId_key`를 유지한 상태에서 준비 코드의 URL 교체·팀 삭제·수집 회귀까지 함께 실행했다.

실제 부분 유니크를 적용한 첫 전체 통합 실행은 6개 파일의 15개 테스트에서 실패했다. 기존 fixture가 이전 레포와 현재 레포에 동일한 `teamId`를 넣고 있었기 때문이다. 해당 fixture의 이전·미연결 레포만 `teamId: null`로 명시했다. 이전 fact를 현재 레포에 섞지 않는 조회·시드 회귀의 기대값은 유지했다. 이는 제품의 교체 후 보존 정책을 되돌리는 변경이 아니며, 실제 교체 시 이전 레포·fact 삭제는 준비 PR의 실 DB 회귀가 별도로 검사한다.

| fixture 파일                                              | 실제 검사 대상                                                                | 수정·판정                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `repository-provision-worker.service.integration.spec.ts` | 이미 연결된 현재 레포에 초대를 보내며 다른 레포의 성공 초대를 재사용하지 않음 | 이전 레포의 teamId만 null. 현재 레포에 대한 발급 실행이므로 실제 URL 교체를 재현하지 않음                                  |
| `e2e-program-authoring-fixture.integration.spec.ts`       | 현재 레포 관측값의 멱등 시드와 다른 레포 fact 비변경                          | 수동 연결 해제 시 applicationId와 teamId를 함께 null. 제품 교체 함수가 아닌 시드의 쓰기 범위를 검사                        |
| `program-team-repository-evidence.integration.spec.ts`    | 현재 연결 레포만 합산하고 감사 이력의 옛 URL을 표시                           | 이전 레포 teamId만 null. 조회가 다른 레포 fact를 지우지 않는다는 기대값 유지. 준비 PR에서 읽기 격리를 설명하도록 이름 수정 |
| `program-team-activity.integration.spec.ts`               | 현재 레포 수집 전 상태·기간·팀원·인가 및 URL 감사 이력                        | 레포 A의 teamId만 null. 현재 B의 활동과 감사 이력을 검사. 준비 PR에서 읽기 격리를 설명하도록 이름 수정                     |
| `program-activity-timeline.integration.spec.ts`           | 미연결 레포의 fact를 타임라인에서 제외                                        | 미연결 레포 teamId만 null. 교체 후 보존을 요구하는 동작 검사는 없음                                                        |
| `outsider-contribution.integration.spec.ts`               | 현재 지원·기간만 외부 기여 집계에 포함                                        | detached 레포 teamId만 null. 지원 연결이 없는 레포의 집계 제외 계약 유지                                                   |

게이트에서 지적한 두 이름의 설명 충돌은 준비 PR에서 수정했다. 두 테스트는 교체 함수를 호출하지 않고 무관한 행을 직접 넣어 읽기 격리를 검사하며 기존 기대값을 유지한다. 감사 이력은 보존하지만 실제 교체의 옛 레포·fact는 삭제한다.

이 PR은 최신 main의 제품 코드를 그대로 사용한다. main 대비 추가 제품·UI·가이드 변경은 없으며 retire SQL과 회귀·fixture·증거 문서만 남는다. 운영 적용 전 새 백업과 승인 건수를 확인해야 한다.
