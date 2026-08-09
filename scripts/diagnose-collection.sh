#!/usr/bin/env bash
# 수집 갱신 정지 진단 — read-only.
#
# "랭킹이 비어 있다"가 아니라 "랭킹이 멈췄다"를 가르는 스크립트다.
# 숫자는 있는데 안 늘어나는 상황에서 원인 후보 10개(C1~C10) 중 하나를 1차 판정한다.
#
# 4층으로 좁힌다.
#   O0 접근성  — DB에 붙을 수 있는가
#   O1 시간축  — 어디서 멈췄는가 (테이블별 최신 시각)
#   O2 집합축  — 무엇이 수집 대상인가 (source/presence/visibility 분포)
#   O3 표면축  — 화면이 DB를 따라오는가 (공개 랭킹 응답)
#
# 이 스크립트는 SELECT 만 실행한다. 쓰기·삭제·마이그레이션을 하지 않는다.
# 출력에 저장소 이름·학생 식별자·접속 문자열을 담지 않는다 — CI 로그와 PR 본문이 공개 범위다.
#
# 사용:
#   DATABASE_URL=... scripts/diagnose-collection.sh
#   DATABASE_URL=... RANKING_URL=https://<host>/api/v1/ranking scripts/diagnose-collection.sh
#
# 서버 접속은 `docs/deploy/server-runbook.md` M1(SSM 또는 Tailscale SSH)을 따른다.
set -euo pipefail

readonly STALE_THRESHOLD_HOURS=${STALE_THRESHOLD_HOURS:-2}
readonly INVENTORY_STALE_HOURS=${INVENTORY_STALE_HOURS:-24}
readonly RANKING_URL=${RANKING_URL:-}
readonly RANKING_CACHE_TTL_SECONDS=${RANKING_CACHE_TTL_SECONDS:-60}

if [[ -z ${DATABASE_URL:-} ]]; then
  echo "diagnose-collection: DATABASE_URL 이 없다 — 서버 안에서 실행한다(server-runbook.md M1)" >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "diagnose-collection: psql 이 없다" >&2
  exit 1
fi

# psql 을 read-only 트랜잭션으로 고정한다. 실수로 쓰기 구문이 들어가도 서버가 거부한다.
run_sql() {
  psql "$DATABASE_URL" \
    --no-psqlrc --tuples-only --no-align --field-separator='|' \
    --set=ON_ERROR_STOP=1 \
    --command="BEGIN TRANSACTION READ ONLY; $1 ; COMMIT;"
}

section() {
  echo
  echo "── $1"
}

# ── O0 접근성 ────────────────────────────────────────────────────────────────
section "O0 접근성"
if ! run_sql "SELECT 1" >/dev/null 2>&1; then
  echo "  DB 연결 실패 — 이 시점에서 멈춘다. 접속 경로부터 복구한다."
  exit 1
fi
echo "  DB 연결 OK (read-only 트랜잭션)"

# ── O1 시간축 ────────────────────────────────────────────────────────────────
# 어느 층에서 시간이 멈췄는지가 후보를 즉시 가른다.
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

# 스윕이 최근에 돌았는지로 후보군이 갈린다.
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

# C7 — fact 는 늘어나는데 집계만 안 따라오는 경우.
c7_lag=$(run_sql "
SELECT count(*) FROM \"CollectionCommitFact\"
WHERE \"observedAt\" > COALESCE((SELECT max(\"updatedAt\") FROM \"Contribution\"), 'epoch')
")
if [[ ${c7_lag:-0} -gt 0 ]]; then
  echo "  집계보다 나중에 들어온 커밋 fact ${c7_lag}건 → C7(aggregate 만 고장) 유력"
fi

# C4 — 커서가 특정 저장소에서 멈춰 사이클이 안 닫히는 경우.
c4_open=$(run_sql "
SELECT count(*) FROM \"CollectionSyncCursor\" WHERE \"cycleCompletedAt\" IS NULL
")
if [[ ${c4_open:-0} -gt 0 ]]; then
  echo "  닫히지 않은 사이클 ${c4_open}건 → C4(cursor 정지) 후보. 같은 저장소 id 가 반복 실패하는지 로그로 확증"
fi

# C2 — 죽은 워커가 잡고 있는 lease.
c2_held=$(run_sql "
SELECT count(*) FROM \"CollectionSyncLease\" WHERE \"expiresAt\" > now()
")
if [[ ${c2_held:-0} -gt 0 ]]; then
  echo "  살아 있는 sync lease ${c2_held}건 → C2(stale lease) 후보"
fi

# C3 — cutover quiesce 가 트리거를 막고 있는 경우.
c3_quiesced=$(run_sql "
SELECT count(*) FROM \"CollectionCutoverLease\" WHERE \"expiresAt\" > now()
")
if [[ ${c3_quiesced:-0} -gt 0 ]]; then
  echo "  활성 cutover lease ${c3_quiesced}건 → C3(quiesce, COL_008 거부) 후보"
fi

# ── O2 집합축 ────────────────────────────────────────────────────────────────
# 이름을 뽑지 않는다. 분포와 개수만 본다.
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

# C9 — 인벤토리가 오래 partial 이면 신규 저장소가 관측되지 않는다.
c9_stale=$(run_sql "
SELECT count(*) FROM \"GithubRepository\"
WHERE \"source\" = 'ORG_PROVISIONED'
  AND (\"lastCompleteInventoryObservedAt\" IS NULL
       OR \"lastCompleteInventoryObservedAt\" < now() - interval '${INVENTORY_STALE_HOURS} hours')
")
if [[ ${c9_stale:-0} -gt 0 ]]; then
  echo "  인벤토리가 ${INVENTORY_STALE_HOURS}시간 넘게 갱신 안 된 조직 저장소 ${c9_stale}건 → C9(인벤토리 partial) 후보"
fi

# C10 — 외부 저장소는 스윕이 재발견하지 않는다. 등록 자체가 누락되면 O1 이 못 잡는다.
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

# ── O3 표면축 ────────────────────────────────────────────────────────────────
# DB 가 최신인데 화면만 옛것이면 캐시나 배포본 문제다.
section "O3 표면축 — 공개 랭킹 응답"
if [[ -z $RANKING_URL ]]; then
  echo "  RANKING_URL 미지정 — 표면 확인을 건너뛴다"
else
  first=$(curl -fsS --max-time 20 "$RANKING_URL" | sha256sum | cut -d' ' -f1)
  echo "  1차 응답 해시 ${first:0:12}"
  echo "  캐시 TTL(${RANKING_CACHE_TTL_SECONDS}s) 초과 대기 후 재조회"
  sleep "$((RANKING_CACHE_TTL_SECONDS + 5))"
  second=$(curl -fsS --max-time 20 "$RANKING_URL" | sha256sum | cut -d' ' -f1)
  echo "  2차 응답 해시 ${second:0:12}"
  if [[ $first == "$second" ]]; then
    echo "  캐시 만료 후에도 응답 불변 — DB 가 최신이면 C8(배포본 옛것) 후보. IMAGE_TAG 확인"
  else
    echo "  응답이 바뀌었다 — 표면은 DB 를 따라온다"
  fi
fi

# ── 요약 ─────────────────────────────────────────────────────────────────────
section "요약"
printf '  스윕 상태          %s\n' "$sweep_fresh"
printf '  마지막 스윕        %s\n' "${stream_last_run:-<없음>}"
printf '  마지막 커밋 관측    %s\n' "${commit_observed:-<없음>}"
printf '  마지막 집계 갱신    %s\n' "${aggregate_updated:-<없음>}"
echo
echo "  후보를 1개로 좁힌 뒤 로그로 확증한다:"
echo "    collection.scheduler.completed / .failed / .sync_failed / collection.sync.repository_failed"
echo "  종료 조건은 원인 1개 지목 + 다음 tick(≤1h)에 max(observedAt) 전진이다."
