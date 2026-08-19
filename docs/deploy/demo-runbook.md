# 데모 서버 정비 런북 (demo-runbook)

이 문서는 라이브 시연 전날, 배포 서버를 데모 상태로 정비하는 수동 절차의 단일 소유 런북이다(qa-econovation-batch TODO 12·14).
서버 접속·설치·파이프라인 계약의 원본은 [server-runbook](./server-runbook.md), 배포 전 검증의 원본은 [pre-deploy-verify](./pre-deploy-verify.md), 배포 인가·롤백 계약의 원본은 [ADR-002](../decisions/ADR-002-CI-CD-파이프라인.md)다.
절차는 D1부터 D10까지 순서대로 실행하며, 앞 단계의 검증을 통과해야 다음으로 넘어간다.

## 0. 절대 경계 (먼저 읽는다)

- 이 저장소는 public이다([security](../rules/security.md)).
- 실제 호스트명·IP·SSH 별칭·계정명·시크릿·실데이터 행·스크린샷은 이 문서와 커밋·PR·로그 어디에도 적지 않는다.
- 아래 `<...>` 자리표시자의 실제 값은 **운영 credentials vault**가 원본이다(AGENTS.md §2, [server-runbook](./server-runbook.md) §8). vault 이름·내부 경로·노트명은 이 저장소에 적지 않는다.
- oss-hub 구축 프로그램(D3에서 ID를 보호 목록에 고정)은 어떤 단계에서도 삭제·개명하지 않는다.
- 실제 OAuth로 가입한 사용자 계정은 삭제·name 변경 대상에서 제외한다.
- 이름·언어 휴리스틱으로 직접 DML을 실행하지 않는다 — 모든 UPDATE·purge는 D3에서 작성한 ID 매니페스트에 있는 ID로만 수행한다.
- 각 단계의 예상 건수와 실제 건수가 다르면 그 자리에서 중단하고 원인을 확인한다.
- 운영 서버에서 `docker compose down -v`는 절대 쓰지 않는다(`pgdata` 보존).
- 학생 토큰으로 운영 서버에 쓰기 API를 호출하지 않는다 — 학생 역할 쓰기 단계는 사람이 수행하는 체크포인트다(AGENTS.md §4).

## 1. 표기 규약

- `<deploy-host-alias>` — 운영자가 자신의 SSH 설정에 등록한 배포 호스트 별칭 (실제 값: 운영 credentials vault)
- `<public-host>` — 서비스 공개 도메인 또는 공인 접점 (실제 값: 운영 credentials vault)
- `<release-tag>` / `<release-sha>` — 이번 배포의 Release tag와 main 40-hex SHA
- `<production-env-file>` — 운영 env 파일의 서버 내 임시 경로 (원본: Jenkins Credentials Store `oss-hub-production-env`)
- `<admin-session-cookie>` — ADMIN 계정으로 로그인한 브라우저 세션의 `__Host-oss_session` 쿠키 값
- `<program-id>` / `<user-id>` — D3 매니페스트에 기록한 대상 ID
- 각 스텝은 명령 → 예상 출력 → 검증 → 중단·복구의 순서로 적는다.

## D1. 배포 게이트

플랜 TODO 1~11의 PR이 전부 main에 병합된 뒤에만 시작한다.

```sh
# 1) 배포 대상 SHA 기록 (로컬에서 실행)
git fetch origin main
git rev-parse origin/main   # <release-sha>로 기록

# 2) 그 SHA로 full Release 발행 — 발행이 곧 배포 인가다(ADR-002)
gh release create <release-tag> --target <release-sha> --title "<release-tag>" --notes "데모 서버 정비 배포"

# 3) GitHub Actions deploy 워크플로가 Jenkins를 트리거했는지 확인 (.github/workflows/deploy.yml)
gh run list --workflow deploy.yml --limit 1
```

- 예상 출력: deploy 워크플로 run이 `completed / success`.
- 검증: Jenkins `oss-hub-release-cd` 빌드가 rollout smoke까지 성공했는지 콘솔 로그로 확인한다([server-runbook](./server-runbook.md) M7).
- 검증: 운영 컨테이너의 OCI version이 `<release-tag>`, revision이 `<release-sha>`와 일치하는지 [pre-deploy-verify](./pre-deploy-verify.md) ②의 `docker inspect` 라벨 대조로 확인한다.
- 중단: 스모크 실패 또는 SHA 불일치면 이후 단계로 넘어가지 않는다 — 롤백·재배포는 ADR-002 계약을 따른다.

## D2. 서버 접속

팀 VPN(tailnet)에 연결한 뒤, 운영자가 자신의 SSH 설정에 등록해 둔 별칭으로 접속한다.

```sh
ssh <deploy-host-alias>
```

- 별칭이 가리키는 실제 호스트·계정·키의 원본은 **운영 credentials vault**다 — 이 저장소에는 어떤 형태로도 적지 않는다.
- 검증: [server-runbook](./server-runbook.md) M1과 동일하게 대상 서버가 맞는지 먼저 확인하고, 아니면 즉시 종료한다.
- 이후 DB 질의는 실행 중 postgres 컨테이너를 경유한다(호스트에 DB 포트가 공개돼 있지 않다).

```sh
postgres_id="$(sudo docker ps -q \
  --filter label=com.docker.compose.project=oss-hub \
  --filter label=com.docker.compose.service=postgres)"
test -n "$postgres_id"
```

## D3. 읽기 전용 preflight → ID 매니페스트 작성

어떤 쓰기 작업보다 먼저, 아래 읽기 전용 질의로 전체 현황을 뜬다.

```sh
# 프로그램 전수: id·이름·lifecycle·생성일·자식 건수
sudo docker exec -i "$postgres_id" sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT p.id, p.name, p.lifecycle, p."createdAt",
  (SELECT count(*) FROM "Application" a WHERE a."programId" = p.id) AS applications,
  (SELECT count(*) FROM "Team" t WHERE t."programId" = p.id) AS teams,
  (SELECT count(*) FROM "BoardPost" b WHERE b."programId" = p.id) AS posts,
  (SELECT count(*) FROM "Milestone" m WHERE m."programId" = p.id) AS milestones
FROM "Program" p
ORDER BY p."createdAt";
SQL

# 사용자 전수: id·name·nickname·역할·상태
sudo docker exec -i "$postgres_id" sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT id, nickname, name, role, "accountStatus", "createdAt"
FROM "User"
ORDER BY "createdAt";
SQL
```

출력을 근거로 아래 세 목록을 담은 ID 매니페스트를 작성한다.

1. 개명 대상 프로그램: `<program-id>` + 새 이름
2. name 정리 대상 합성 계정: `<user-id>` + 새 name
3. purge 대상 테스트 프로그램: `<program-id>` + 위 질의의 자식 건수(예상 삭제 규모)

매니페스트 작성 규칙은 다음과 같다.

- oss-hub 구축 프로그램의 ID를 맨 위 보호 목록에 고정하고, 어떤 목록에도 넣지 않는다.
- 실제 OAuth 가입자 계정은 2번 목록에서 제외한다 — 시드 합성 계정만 대상이다.
- 매니페스트는 저장소에 커밋하지 않고 비추적 경로(예: 서버 홈 디렉터리의 임시 파일 또는 로컬 `.omo/evidence/`)에만 보관한다.
- 매니페스트를 사용자에게 한 번 보고한 뒤에 D4로 넘어간다.
- 중단: 어느 목록에든 보호 ID가 섞여 있으면 실행하지 않고 매니페스트를 다시 작성한다.

## D4. 개명·name 정리 UPDATE (매니페스트 ID 한정)

매니페스트의 ID를 그대로 옮겨 적은 UPDATE만 실행한다.

```sh
sudo docker exec -i "$postgres_id" sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
BEGIN;
UPDATE "Program" SET name = '<새 프로그램 이름>' WHERE id = '<program-id>';
UPDATE "User" SET name = '<새 합성 이름>' WHERE id = '<user-id>';
COMMIT;
SQL
```

- 예상 출력: 각 문장이 `UPDATE 1`.
- 검증: D3의 프로그램·사용자 질의를 다시 실행해 매니페스트의 새 값과 일치하는지 확인한다.
- 중단: 어떤 문장이든 영향 행 수가 1이 아니면 `COMMIT` 전에 `ROLLBACK;`으로 되돌리고 매니페스트를 재검토한다.
- 복구: 잘못 반영된 값은 매니페스트에 기록해 둔 이전 값으로 같은 형태의 UPDATE를 다시 실행한다.

## D5. 테스트 프로그램 purge (ADMIN 전용)

`DELETE /api/v1/programs/:id/purge`는 ADMIN 전용이며, 프로그램과 산하 자식 데이터를 순서대로 삭제하고 엔티티별 `deletedCounts`를 응답한다.
매니페스트의 purge 목록에 있는 `<program-id>`만, 한 건씩 실행한다.

```sh
curl -s -o /tmp/purge-result.json -w '%{http_code}\n' -X DELETE \
  "https://<public-host>/api/v1/programs/<program-id>/purge" \
  -H "Origin: https://<public-host>" \
  -H "Cookie: __Host-oss_session=<admin-session-cookie>"
jq . /tmp/purge-result.json
```

- 예상 출력: HTTP 200과 `{"id":"<program-id>","deleted":true,"deletedCounts":{...}}`.
- 검증: 응답의 `deletedCounts`를 매니페스트에 적어 둔 예상 자식 건수와 항목별로 대조한다.
- 검증: 파일 객체는 트랜잭션 안에서 지우지 않고 tombstone → cleanup worker 경유로 지워지므로, 응답 직후 객체가 남아 있어도 결함이 아니다.
- 중단: `deletedCounts`가 예상과 불일치하면 즉시 중단하고, 남은 purge 목록을 실행하지 않은 채 원인을 확인한다.
- 중단: 보호 목록의 ID는 어떤 이유로도 이 API에 넣지 않는다.
- 복구: purge는 되돌릴 수 없으므로, 실행 전 매니페스트 대조가 유일한 방어선이다 — 확신이 없으면 실행하지 않는다.

## D6. demo 시드 실행

demo 프로파일의 계약(멱등, `seed:demo:*` 결정적 ID, production 게이트)은 `apps/backend/prisma/README.md`가 원본이다.
운영 이미지에는 ts-node가 없으므로, 서버에서 Release 시점 소스를 받아 compose 네트워크에 붙인 일회용 컨테이너로 실행한다.

```sh
# 1) Release 시점 소스 확보 (서버 홈 디렉터리)
git clone --depth 1 --branch <release-tag> https://github.com/JNU-SWCU/oss-hub.git ~/oss-hub-demo-seed
cd ~/oss-hub-demo-seed

# 2) 시드 실행 — env 파일은 Jenkins credential에서 임시로 내려받아 0600으로 두고, 끝나면 즉시 삭제한다
sudo docker run --rm --network oss-hub_default \
  -v "$PWD:/workspace" -w /workspace \
  --env-file "<production-env-file>" \
  -e NODE_ENV=production -e SEED_DEMO_ALLOW_PRODUCTION=1 \
  node:24-alpine sh -lc '
    corepack enable pnpm &&
    pnpm install --frozen-lockfile --filter backend... &&
    pnpm --filter backend exec prisma generate &&
    pnpm --filter backend prisma db seed -- --profile demo
  '
```

- 예상 출력: `[seed]` 로그가 profile=demo로 완료되고 오류 없이 종료.
- 검증: `https://<public-host>/programs` 목록에 사업단 톤의 데모 프로그램이 보인다.
- 검증: 같은 명령을 한 번 더 실행해도 행 수가 늘지 않는다(멱등).
- 되돌리기: `--teardown` 플래그를 붙인 같은 명령이 이 프로파일이 만든 `seed:demo:*` 행 전부를 의존성 순서로 일괄 삭제한다.

```sh
# teardown — 마지막 인자만 다르다
#   pnpm --filter backend prisma db seed -- --profile demo --teardown
```

- 중단: `SEED_DEMO_ALLOW_PRODUCTION=1` 없이 거부되는 것은 정상 게이트다 — 게이트를 우회하는 다른 방법을 쓰지 않는다.
- 사용을 마친 `<production-env-file>`은 즉시 삭제한다.

## D7. Econovation 2026 공개 repo 수집 등록

등록 대상은 JNU-econovation 조직의 공개 저장소 8개다: `eco-knock-be-central`, `eco-knock-fe`, `eco-knock-ai`, `plover-be`, `PLOBER-FE`, `Geharbang-AI`, `econo-passport`, `clean_alba-BE`.
수집·랭킹 테이블에 합성 데이터를 직접 넣지 않는다 — 등록은 ADMIN discovery 경로, 적재는 실제 sweep으로만 한다.

```sh
# 1) 저장소 기여자 중 가입·동의를 마친 학생 login으로 외부 공개 repo를 탐색·등록한다 (repo가 커버될 때까지 반복)
curl -s -X POST "https://<public-host>/api/v1/admin/collection/discover-external" \
  -H "Content-Type: application/json" \
  -H "Origin: https://<public-host>" \
  -H "Cookie: __Host-oss_session=<admin-session-cookie>" \
  -d '{"githubLogin":"<student-github-login>"}'
```

- 예상 출력: `discoveredCount`·`upsertedCount`가 0보다 큰 JSON.
- 아직 가입·동의한 기여자가 없는 저장소는 이 경로로 등록되지 않는다 — 그 저장소는 D10 리허설의 지원(OWN repo URL 연결) 승인 시점에 자동 등록되는 경로를 쓴다.

```sh
# 2) 8개 저장소가 EXTERNAL_PUBLIC으로 등록됐는지 확인
sudo docker exec -i "$postgres_id" sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
SELECT "nameWithOwner", source FROM "GithubRepository"
WHERE "nameWithOwner" IN (
  'JNU-econovation/eco-knock-be-central', 'JNU-econovation/eco-knock-fe',
  'JNU-econovation/eco-knock-ai', 'JNU-econovation/plover-be',
  'JNU-econovation/PLOBER-FE', 'JNU-econovation/Geharbang-AI',
  'JNU-econovation/econo-passport', 'JNU-econovation/clean_alba-BE');
SQL

# 3) 실제 sweep 실행 (org·external 두 sweep이 함께 돈다)
curl -s -X POST "https://<public-host>/api/v1/admin/collection/trigger" \
  -H "Origin: https://<public-host>" \
  -H "Cookie: __Host-oss_session=<admin-session-cookie>"

# 4) 실행 결과 확인 (scope별 최근 실행 1건)
curl -s "https://<public-host>/api/v1/admin/collection/runs" \
  -H "Cookie: __Host-oss_session=<admin-session-cookie>"
```

- 예상 출력: 3)이 202와 `runId`, 4)의 external scope가 성공 상태.
- 검증: `https://<public-host>/ranking`에 수집 결과가 반영돼 노출된다(표시명은 `githubLogin`만, [security](../rules/security.md)).
- 중단: sweep이 실패 상태면 backend 로그의 `collection.admin.*` 이벤트로 원인을 확인하고, 재트리거 전에는 랭킹 반영을 판정하지 않는다.
- 복구: discovery·sweep은 upsert 기반이라 재실행이 안전하다.

## D8. 스토리지 고아 객체 점검·정리 (QA60)

reconcile CLI는 운영 backend 이미지에 컴파일돼 들어 있다(`apps/backend/src/submissions/cli/reconcile-storage-orphans.ts`).
반드시 `--report`로 먼저 보고, 결과를 확인한 뒤에만 `--delete`를 실행한다.

```sh
# 1) 리포트 모드 — 아무것도 지우지 않는다
sudo docker run --rm --network oss-hub_default \
  --env-file "<production-env-file>" \
  "oss-hub-backend:<release-tag>" \
  node dist/src/submissions/cli/reconcile-storage-orphans.js --report

# 2) 리포트의 orphanKeys를 확인·보관한 뒤 삭제 모드 실행
sudo docker run --rm --network oss-hub_default \
  --env-file "<production-env-file>" \
  "oss-hub-backend:<release-tag>" \
  node dist/src/submissions/cli/reconcile-storage-orphans.js --delete
```

- 예상 출력: `storage-orphan.result` JSON 한 줄(모드·cutoff·orphanKeys·deletedKeys·skippedReferencedKeys).
- 검증: `--delete`의 `deletedKeys`가 직전 `--report`의 `orphanKeys`와 일치하고, `skippedReferencedKeys`의 사유가 설명 가능해야 한다.
- 리포트 원본은 커밋하지 않고 비추적 경로(`.omo/evidence/`)에만 보관한다.
- 중단: `--report`의 orphanKeys에 예상 밖 prefix나 설명 불가한 key가 있으면 `--delete`를 실행하지 않는다.
- 중단: DB 연결 실패 시 CLI가 아무것도 지우지 않고 실패 종료하는 것이 정상이다.
- 복구: 삭제 전 최신 배포의 object backup이 `${BACKUP_DIR}/objects/`에 있다 — 복구 판단은 [server-runbook](./server-runbook.md) M8 드릴 계약을 따른다.

## D9. 에코노베이션 대회 프로그램 개설 (TODO 14)

이 프로그램은 합성 데모가 아니라 학생이 실제로 지원하는 실운영 공간이므로, 시드가 아니라 정식 프로그램 생성 화면(`/programs/new`, ADMIN·STAFF)으로 만든다.

- [ ] 프로그램 이름·설명·일정은 운영자 확인 값을 사용한다(이 문서에는 적지 않는다).
- [ ] 날짜 제약을 지킨다: `applicationEndAt <= startAt < endAt`이고 모집 마감(`applicationEndAt`)은 미래여야 한다.
- [ ] 팀 신청이 가능하도록 팀 최소·최대 인원을 대회 규칙에 맞게 설정한다.
- [ ] 지원 시 기존 저장소 연결(OWN repo URL) 모드를 사용할 수 있는지 신청 화면에서 확인한다.
- [ ] 지원서·팀·제출물은 사전 생성하지 않는다 — 순수 모집 상태로 발행한다.
- 검증: 비로그인 상태에서 `https://<public-host>/programs`의 모집 중 목록에 노출되고 상세·신청 화면에 진입된다.
- 중단: 날짜 제약 위반으로 생성이 거부되면 값을 고쳐 다시 시도한다(검증 완화 금지).
- 복구: 잘못 만든 경우 발행 전이면 편집으로, 발행 후 오염됐으면 D5 purge 절차(매니페스트 등재 후)로 정리한다.

## D10. 시연 리허설 체크리스트

운영 서버에서 학생 역할의 쓰기 단계는 전부 사람이 직접 수행한다(에이전트의 학생 토큰 쓰기 금지).

| # | 단계 | 수행 주체 | 화면 경로 | 성공 판정 |
| --- | --- | --- | --- | --- |
| 1 | 학생 계정 가입 (GitHub OAuth → 온보딩 → 동의) | 사람 | `/signup` → `/onboarding` → `/consent` | 대시보드 진입, 역할 STUDENT |
| 2 | 대회 지원: 팀 생성·초대 + OWN repo URL 연결 | 사람 | `/programs/<program-id>` → 신청 | 지원 완료 상태 표시, 잘못된 URL은 필드 오류로 거부 |
| 3 | 교직원 승인 | 사람(STAFF/ADMIN) | staff 지원서 관리 화면 | 지원 상태가 승인으로 전환 |
| 4 | 수집 등록 확인 | 에이전트 가능(읽기 전용) | D7의 SQL 또는 admin collection 화면 | 해당 repo가 `EXTERNAL_PUBLIC`으로 존재 |
| 5 | 랭킹 노출 확인 | 에이전트 가능(읽기 전용) | `/ranking` | 가입 학생의 `githubLogin`이 노출(기여 0이어도 0으로 표시) |
| 6 | 프로그램 내 수집·활성화 현황 확인 | 에이전트 가능(읽기 전용) | 프로그램 staff 현황 화면 | 연결 repo·수집 상태가 의미 있게 표시 |

- 4~6이 비어 있으면 D7의 sweep을 다시 트리거하고 `runs`로 완료를 확인한 뒤 재판정한다.
- 중단: 2에서 승인 이후에도 repo가 등록되지 않으면 provision worker 로그(`repositories.provision.failed`)를 확인하고 리허설을 멈춘다.
- 리허설 중 만든 임시 계정·팀·지원서는 시연에 그대로 쓰지 않을 경우 매니페스트에 등재한 뒤에만 정리한다.

## 공통 중단·복구 원칙

- 중단 조건은 세 가지다: 건수 불일치, 오류 응답, 대상 목록에 보호 ID 포함.
- 중단하면 그 단계의 명령·출력 원본을 비추적 경로(`.omo/evidence/`)에 보관하고 사용자에게 보고한 뒤 재개 여부를 결정한다.
- DB 백업 없이 진행하는 결정은 플랜(qa-econovation-batch)에 기록된 사용자 결정이다 — 그래서 모든 파괴적 단계는 매니페스트 대조를 통과해야만 실행한다.
- 이 문서에 실서버 정보·실데이터가 추가되려는 변경은 리뷰에서 차단한다([security](../rules/security.md) deny-list).
