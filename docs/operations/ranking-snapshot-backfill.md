**한국어** | [English](ranking-snapshot-backfill.en.md)

# 랭킹 스냅샷 백필 운영 절차

`/ranking`의 순위 변화 그래프는 `GithubUserActivitySnapshot` 테이블의 일별 행만 읽습니다.
새 배포 직후에는 그날 이후의 스냅샷만 쌓여 있어서 그래프가 한 점에서 시작합니다.
1월부터의 월별 점을 채우려면 관리자가 백필을 한 번 실행해야 합니다.
이 절차는 연 1회, 2026년 이후의 연도에 대해서만 쓰입니다.

대상 독자는 백엔드 운영 권한과 `ADMIN` 계정을 가진 사람입니다.

## 1. 마이그레이션을 먼저 적용한다

새 백엔드가 뜨기 전에 `20261031000000_add_github_user_activity_snapshot` 마이그레이션이 적용돼 있어야 합니다.
시간별 수집은 `GithubUserActivityHistory` 갱신과 스냅샷 기록을 한 트랜잭션으로 묶기 때문에, 테이블이 없으면 개인 활동 수집 전체가 실패합니다.
배포 파이프라인([Jenkinsfile](../../Jenkinsfile))이 백엔드 컨테이너 기동 전에 `prisma migrate deploy`를 실행하므로, 평소에는 추가 조작이 필요 없습니다.
수동 배포라면 마이그레이션을 먼저 돌리고 나서 애플리케이션을 올립니다.

## 2. 배포 후 첫 개인 수집이 끝날 때까지 기다린다

백필은 별 수를 GitHub에서 다시 세지 않고, 그 연도의 가장 최근 `SWEEP` 스냅샷 값을 가져다 씁니다.
배포 전 값으로 과거 달을 채우지 않도록, 각 사용자는 그 연도의 `SWEEP` 스냅샷이 하나라도 있을 때만 백필 대상이 됩니다.

수집 스케줄러는 매시 정각(`Asia/Seoul`)에 돌고, 개인 수집이 끝나면 다음 로그를 남깁니다.

```text
collection.scheduler.completed  scope=person
```

이 로그를 확인한 뒤 다음 단계로 갑니다.
기다리기 어렵다면 관리자 수동 수집(`POST /api/v1/admin/collection/trigger`)으로 같은 개인 수집을 돌릴 수 있고, 이때 로그 접두사는 `collection.admin.completed`입니다.

## 3. 백필을 실행한다

관리자 세션 쿠키와 `Origin` 헤더를 함께 보냅니다.
`Origin` 헤더가 없으면 요청이 거부됩니다.

```bash
curl -i -X POST '<backend-base-url>/api/v1/admin/collection/snapshot-backfill' \
  -H 'Origin: <frontend-origin>' \
  -H 'Content-Type: application/json' \
  -b '<admin-session-cookie>' \
  -d '{"year":2026}'
```

성공하면 `202`와 `{"accepted":true,"year":2026}`가 돌아옵니다.
실제 작업은 응답 후 백그라운드에서 이어집니다.

| 응답 코드 | 뜻                                                                       | 할 일                                                           |
| --------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `202`     | 접수됨                                                                   | 4단계에서 완료 로그를 확인한다                                  |
| `400`     | `year`가 정수가 아니거나 2026년 미만 또는 현재 서울 기준 연도보다 크다   | 본문의 `year`를 고친다                                          |
| `401`     | 세션이 없거나 만료됐다                                                   | 관리자로 다시 로그인한다                                        |
| `403`     | 세션이 관리자가 아니다                                                   | `ADMIN` 계정으로 실행한다                                       |
| `409`     | 해당 연도의 `SWEEP` 스냅샷이 아직 없거나, 저장소 전환으로 수집이 멈춰 있다 | 2단계로 돌아가 개인 수집을 기다리거나 전환 작업이 끝난 뒤 재시도한다 |

같은 연도로 동시에 두 번 호출해도 한 번만 돌고, 이미 채워진 달은 다시 쓰지 않습니다.
그래서 재실행은 안전합니다.

## 4. 결과를 확인한다

완료되면 다음 로그가 남습니다.

```text
collection.snapshot_backfill.completed
```

함께 기록되는 값 중 다음 둘을 봅니다.

- `writtenRowCount`: 새로 쓴 스냅샷 행 수입니다. 사용자당 1월부터 지난달까지가 채워집니다.
- `skippedStaleCount`: 그 연도의 `SWEEP` 스냅샷이 없어서 건너뛴 사용자 수입니다. 0보다 크면 다음 정시 수집이 끝난 뒤 3단계를 그대로 다시 실행합니다. 이미 채워진 사용자는 요청도 쓰기도 발생하지 않습니다.

실패는 두 가지로 나뉩니다.
작업 전체가 깨지면 `collection.snapshot_backfill.failed`가, 특정 사용자만 실패하면 `collection.snapshot_backfill.user_failed`가 남고 나머지 사용자는 계속 처리됩니다.
GraphQL 예산이 부족해지면 `stoppedForBudget`이 `true`로 끝나므로, 다음 시간에 다시 실행하면 남은 사용자가 이어서 채워집니다.

실행 기록은 `/dashboard/audit-logs`의 감사 로그에 **스냅샷 백필 실행**으로 표시됩니다.

## 5. 되돌리기

잘못된 값으로 채웠다면 백필 행만 지우고 다시 실행합니다.
`source = 'SWEEP'` 행은 시간별 수집이 직접 기록한 실측값이므로 건드리지 않습니다.

```sql
DELETE FROM "GithubUserActivitySnapshot"
WHERE source = 'BACKFILL' AND year = 2026;
```

삭제 후 3단계를 다시 실행하면 됩니다.

## 참고

백필로 채운 달은 `starEstimated`가 `true`로 기록되고, 그래프에서 추정값 각주로 표시됩니다.
별 수만 추정이고 커밋·PR·이슈·저장소 수는 그 달까지의 실제 누적값입니다.
