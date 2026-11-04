# Todo 7: 팀 없는 저장소 데이터 정리

준비 PR은 #1726, head는 `e337dce1bd77f04e19e94f99a6ccb0d0be575289`다. 이 PR 위에 쌓인 별도 draft이며 운영 반영을 승인하거나 실행하지 않는다.

## 실행 순서

1. 준비 프론트엔드에서 OSS Hub 등록 정보·수집 기록 삭제와 GitHub 원본 보존 안내를 확인한다.
2. 준비 백엔드를 배포해 조직 인벤토리 자동 등록과 늦은 enrollment 재생성을 중단한다.
3. Todo 5의 프로그램 purge 중단 코드가 운영에 반영됐는지 확인한다. 연결 해제만 하는 옛 purge가 남아 있으면 진행하지 않는다.
4. 다음 릴리스에서 새 백업과 읽기 전용 재집계를 수행한 뒤 이 데이터 마이그레이션을 적용한다.

준비 코드와 삭제 SQL을 같은 릴리스에 넣지 않는다. 배포 실행기는 마이그레이션을 앱 교체보다 먼저 적용한다.

## 승인 범위와 보존

`20261104130000_retire_teamless_github_repositories/migration.sql`은 승인된 레포 12행과 직접 종속 269행만 삭제한다. 각 테이블의 건수가 달라지면 어떤 행도 지우지 않고 중단한다. 팀 불일치도 중단하며, `Application.teamId` 백필 후 부분 유니크로 팀당 레포 0개 또는 1개를 보장한다.

SQL SHA-256은 `d41d67ecbe46a474bb07cc6ef86fb20bd23669c47cbfd7ae3b09a7b7ad187294`이며 서버 복원본에서 검증한 파일과 같다. 정확한 테이블별 건수와 서버 격리·복원·랭킹·정리 영수증은 [준비 단계 증거](task-7-program-table-simplification.md)에 있다.

마이그레이션 기록 외의 애플리케이션 테이블이 모두 빈 신규 DB만 승인 건수 비교를 생략한다. 사용자나 활동 캐시가 있는데 레포만 없는 DB는 신규 설치가 아니므로 중단한다.

`RepositoryInvitation`은 RESTRICT FK이므로 먼저 삭제한다. 레거시 연간 집계 두 테이블은 현재 Prisma 모델에 없지만 기존 FK의 CASCADE로 대상 1행·2행만 삭제한다. 테이블 자체와 무관한 행은 유지한다. 대상 AuditLog 1행, 발급 값 이력, 사용자 활동 기반 랭킹은 보존한다. `applicationId`·`programId` 컬럼 제거와 TeamHistory 전환은 포함하지 않는다.

## 검증 경계

`github-scope-migration.integration.spec.ts`는 실제 SQL을 격리 스키마에 실행한다. 승인 범위 삭제·백필, 각 양수 삭제 건수의 변동 시 롤백, 완전히 빈 DB, 기존 사용자·활동이 있는 레포 0개 DB, 부분 유니크 위반을 검사한다. 운영 복원본에서는 실제 배포 이미지의 랭킹 결과와 17개 테이블 백업 복원을 별도로 대조했다.

공식 통합 실행기가 빈 DB에 87개 마이그레이션을 적용한 뒤 실행한 전체 통합 회귀는 143 suites·1,016 tests 모두 통과했다. 실제 `GithubRepository_teamId_key`를 유지한 상태에서 준비 코드의 URL 교체·팀 삭제·수집 회귀까지 함께 실행했다.

실제 부분 유니크를 적용한 첫 전체 통합 실행은 6개 파일의 15개 테스트에서 실패했다. 기존 fixture가 이전 레포와 현재 레포에 동일한 `teamId`를 넣고 있었기 때문이다. 해당 fixture의 이전·미연결 레포만 `teamId: null`로 명시했다. 이전 fact를 현재 레포에 섞지 않는 조회·시드 회귀의 기대값은 유지했다. 이는 제품의 교체 후 보존 정책을 되돌리는 변경이 아니며, 실제 교체 시 이전 레포·fact 삭제는 준비 PR의 실 DB 회귀가 별도로 검사한다.

| fixture 파일                                              | 실제 검사 대상                                                                | 수정·판정                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `repository-provision-worker.service.integration.spec.ts` | 이미 연결된 현재 레포에 초대를 보내며 다른 레포의 성공 초대를 재사용하지 않음 | 이전 레포의 teamId만 null. 현재 레포에 대한 발급 실행이므로 실제 URL 교체를 재현하지 않음           |
| `e2e-program-authoring-fixture.integration.spec.ts`       | 현재 레포 관측값의 멱등 시드와 다른 레포 fact 비변경                          | 수동 연결 해제 시 applicationId와 teamId를 함께 null. 제품 교체 함수가 아닌 시드의 쓰기 범위를 검사 |
| `program-team-repository-evidence.integration.spec.ts`    | 현재 연결 레포만 합산하고 감사 이력의 옛 URL을 표시                           | 이전 레포 teamId만 null. 조회가 다른 레포 fact를 지우지 않는다는 기대값 유지. 아래 설명 충돌을 명시 |
| `program-team-activity.integration.spec.ts`               | 현재 레포 수집 전 상태·기간·팀원·인가 및 URL 감사 이력                        | 레포 A의 teamId만 null. 현재 B의 활동과 감사 이력을 검사. 아래 설명 충돌을 명시                     |
| `program-activity-timeline.integration.spec.ts`           | 미연결 레포의 fact를 타임라인에서 제외                                        | 미연결 레포 teamId만 null. 교체 후 보존을 요구하는 동작 검사는 없음                                 |
| `outsider-contribution.integration.spec.ts`               | 현재 지원·기간만 외부 기여 집계에 포함                                        | detached 레포 teamId만 null. 지원 연결이 없는 레포의 집계 제외 계약 유지                            |

발견 사항: `program-team-repository-evidence`의 “retaining old repository history”와 `program-team-activity`의 “A→B 직후”라는 설명을 실제 교체 이후 fact 보존 요구로 읽으면 계약 23-1과 충돌한다. 두 테스트는 교체 함수를 호출하지 않고 이전 행을 직접 넣은 읽기 격리 테스트다. 이 결과를 “교체 후 옛 fact를 보존해야 한다”는 근거로 사용하면 안 된다. 옛 URL·삭제 건수의 감사 이력은 보존하지만, 실제 교체 경로의 옛 레포·fact는 삭제한다. 기존 기대값을 없애 통과시키지 않았으며 이 설명상의 충돌을 독립 리뷰에 전달한다.

이 PR은 준비 PR의 제품 코드를 그대로 사용한다. 추가 UI와 가이드 변화는 없고 프로그램 제품 파일 수·줄 수는 준비 단계의 245 files·37,795 lines 그대로다. 운영에 적용할 시점에 다른 Todo와의 충돌, 마이그레이션 정렬, 승인 건수를 다시 확인해야 한다.
