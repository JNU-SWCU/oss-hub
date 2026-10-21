#!/usr/bin/env bash
set -euo pipefail

readonly STALE_THRESHOLD_HOURS=${STALE_THRESHOLD_HOURS:-2}
readonly INVENTORY_STALE_HOURS=${INVENTORY_STALE_HOURS:-24}
readonly RANKING_URL=${RANKING_URL:-}

if [[ -z ${DATABASE_URL:-} ]]; then
  echo "diagnose-collection: DATABASE_URL 이 없다 — 승인된 서버 환경에서 DATABASE_URL을 주입한 뒤 이 스크립트를 다시 실행한다" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "diagnose-collection: psql 이 없다" >&2
  exit 1
fi

run_sql() {
  PGOPTIONS='-c default_transaction_read_only=on' \
    psql "$DATABASE_URL" \
      --no-psqlrc --tuples-only --no-align --field-separator='|' \
      --set=ON_ERROR_STOP=1 \
      --command="$1"
}

section() {
  echo
  echo "── $1"
}

section "O0 접근성"
if ! run_sql "SELECT 1" >/dev/null 2>&1; then
  echo "  DB 연결 실패 — 이 시점에서 멈춘다. 접속 경로부터 복구한다."
  exit 1
fi
echo "  DB 연결 OK (read-only 트랜잭션)"

section "O1 시간축 — 층별 최신 시각"
o1=$(run_sql "
SELECT 'stream.lastRunAt',        max(\"lastRunAt\")                        FROM \"CollectionRepositoryStream\"
UNION ALL SELECT 'stream.lastErrorAt',      max(\"lastErrorAt\")            FROM \"CollectionRepositoryStream\"
UNION ALL SELECT 'commit.observedAt',       max(\"observedAt\")             FROM \"CollectionCommitFact\"
UNION ALL SELECT 'pr.observedAt',           max(\"observedAt\")             FROM \"CollectionPullRequestFact\"
UNION ALL SELECT 'release.observedAt',      max(\"observedAt\")             FROM \"CollectionReleaseFact\"
UNION ALL SELECT 'contribution.updatedAt',  max(\"updatedAt\")              FROM \"Contribution\"
UNION ALL SELECT 'repo.updatedAt',          max(\"updatedAt\")              FROM \"GithubRepository\"
UNION ALL SELECT 'inventory.lastComplete',  max(\"lastCompleteInventoryObservedAt\") FROM \"GithubRepository\"
")
echo "$o1" | while IFS='|' read -r key value; do
  [[ -z $key ]] && continue
  printf '  %-26s %s\n' "$key" "${value:-<없음>}"
done

stream_last_run=$(printf '%s\n' "$o1" | awk -F'|' '$1=="stream.lastRunAt"{print $2}')
commit_observed=$(printf '%s\n' "$o1" | awk -F'|' '$1=="commit.observedAt"{print $2}')
aggregate_updated=$(printf '%s\n' "$o1" | awk -F'|' '$1=="contribution.updatedAt"{print $2}')

sweep_fresh=$(run_sql "
SELECT CASE
         WHEN max(\"lastRunAt\") IS NULL THEN 'none'
         WHEN max(\"lastRunAt\") >= now() - interval '${STALE_THRESHOLD_HOURS} hours' THEN 'fresh'
         ELSE 'stale'
       END
FROM \"CollectionRepositoryStream\"
")

section "O1 판정"
case "$sweep_fresh" in
  none)
    echo "  스윕 기록이 아예 없다 → C1(cron 미등록) 우선 확인"
    ;;
  stale)
    echo "  스윕이 ${STALE_THRESHOLD_HOURS}시간 넘게 안 돌았다 → C1~C5 (cron·lease·cursor·토큰)"
    ;;
  fresh)
    echo "  스윕은 최근에 돌았다 → C6~C10 (probe 오판·aggregate 고장·캐시·인벤토리·등록 누락)"
    ;;
esac

c7_lag=$(run_sql "
SELECT count(*) FROM \"CollectionCommitFact\"
WHERE \"observedAt\" > COALESCE((SELECT max(\"updatedAt\") FROM \"Contribution\"), 'epoch')
")
if [[ ${c7_lag:-0} -gt 0 ]]; then
  echo "  집계보다 나중에 들어온 커밋 fact ${c7_lag}건 → C7(aggregate 만 고장) 유력"
fi

c4_open=$(run_sql "
SELECT count(*) FROM \"CollectionSyncCursor\" WHERE \"cycleCompletedAt\" IS NULL
")
if [[ ${c4_open:-0} -gt 0 ]]; then
  echo "  닫히지 않은 사이클 ${c4_open}건 → C4(cursor 정지) 후보. 같은 저장소 id 가 반복 실패하는지 로그로 확증"
fi

c2_held=$(run_sql "
SELECT count(*) FROM \"CollectionSyncLease\" WHERE \"expiresAt\" > now()
")
if [[ ${c2_held:-0} -gt 0 ]]; then
  echo "  살아 있는 sync lease ${c2_held}건 → C2(stale lease) 후보"
fi

c3_quiesced=$(run_sql "
SELECT count(*) FROM \"CollectionCutoverLease\" WHERE \"expiresAt\" > now()
")
if [[ ${c3_quiesced:-0} -gt 0 ]]; then
  echo "  활성 cutover lease ${c3_quiesced}건 → C3(quiesce, COL_008 거부) 후보"
fi

section "O2 집합축 — 수집 대상 분포"
run_sql "
SELECT \"source\", \"presence\", \"visibility\", count(*),
       COALESCE(max(\"lastCompleteInventoryObservedAt\")::text, '<없음>')
FROM \"GithubRepository\"
GROUP BY 1,2,3 ORDER BY 1,2,3
" | while IFS='|' read -r source presence visibility count inventory; do
  [[ -z $source ]] && continue
  printf '  %-16s %-9s %-8s %5s  inventory=%s\n' "$source" "$presence" "$visibility" "$count" "$inventory"
done

c9_stale=$(run_sql "
SELECT count(*) FROM \"GithubRepository\"
WHERE \"source\" = 'ORG_PROVISIONED'
  AND (\"lastCompleteInventoryObservedAt\" IS NULL
       OR \"lastCompleteInventoryObservedAt\" < now() - interval '${INVENTORY_STALE_HOURS} hours')
")
if [[ ${c9_stale:-0} -gt 0 ]]; then
  echo "  인벤토리가 ${INVENTORY_STALE_HOURS}시간 넘게 갱신 안 된 조직 저장소 ${c9_stale}건 → C9(인벤토리 partial) 후보"
fi

section "O2 판정 — 외부 저장소 등록 대조 (C10)"
run_sql "
SELECT
  (SELECT count(*) FROM \"GithubRepository\" WHERE \"source\" = 'EXTERNAL_PUBLIC'),
  (SELECT count(*) FROM \"Application\" WHERE \"repositoryConnectionMode\" = 'OWN'),
  (SELECT count(*) FROM \"User\" WHERE \"githubId\" IS NOT NULL)
" | while IFS='|' read -r external own users; do
  [[ -z $external ]] && continue
  printf '  EXTERNAL_PUBLIC=%s  OWN 신청=%s  githubId 보유 사용자=%s\n' "$external" "$own" "$users"
  if [[ ${external:-0} -lt ${own:-0} ]]; then
    echo "  OWN 신청보다 등록된 외부 저장소가 적다 → C10(등록 누락) 후보"
  fi
done

section "O3 표면축 — 공개 랭킹 응답"
if [[ -z $RANKING_URL ]]; then
  echo "  RANKING_URL 미지정 — 표면 확인을 건너뛴다"
elif ! command -v curl >/dev/null 2>&1; then
  echo "  curl 이 없어 표면 확인을 건너뛴다 — O0~O2 관측은 위 결과가 유효하다"
  echo "  표면은 HTTP 가 되는 곳에서 직접 본다:"
  echo "    curl -fsS <ranking-url>   # 응답의 dataAsOf 를 위 스윕 시각과 비교"
else
  response=$(curl -fsS --max-time 20 "$RANKING_URL")
  surface_as_of=$(printf '%s' "$response" |
    sed -n 's/.*"dataAsOf":"\([^"]*\)".*/\1/p')
  if [[ -z $surface_as_of ]]; then
    echo "  응답에 dataAsOf 가 없다 — C8(배포본 옛것) 후보. IMAGE_TAG 확인"
  else
    echo "  표면 dataAsOf   $surface_as_of"
    echo "  위 마지막 스윕 시각보다 뒤처지면 C8(배포본 옛것) 후보"
  fi
fi

section "요약"
printf '  스윕 상태          %s\n' "$sweep_fresh"
printf '  마지막 스윕        %s\n' "${stream_last_run:-<없음>}"
printf '  마지막 커밋 관측    %s\n' "${commit_observed:-<없음>}"
printf '  마지막 집계 갱신    %s\n' "${aggregate_updated:-<없음>}"
echo
echo "  후보를 1개로 좁힌 뒤 로그로 확증한다:"
echo "    collection.scheduler.completed / .failed / .sync_failed / collection.sync.repository_failed"
echo "  종료 조건은 원인 1개 지목 + 다음 tick(≤1h)에 max(observedAt) 전진이다."
