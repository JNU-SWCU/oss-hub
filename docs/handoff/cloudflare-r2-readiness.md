# Cloudflare R2 운영 준비 인수인계

> 기준 시각: 2026-09-01 KST
>
> 이 문서는 private Cloudflare R2 전환의 canonical G0–G9 gate와 완료 조건을 소유한다.
>
> 현재 프로덕션 frontend origin과 application object storage는 아직 checkpoint A 전 상태이며 object storage는 MinIO다.
>
> 이 문서는 배포 인가나 R2 전환 완료 영수증이 아니다.

## 공개 저장소 보안 경계

실제 Cloudflare account identifier, endpoint, access key, secret key, bucket identifier, object key, inventory, manifest, immutable provider deployment identifier, Jenkins 내부 주소와 machine path는 제한된 provider/operator store만 소유한다.

GitHub Issue, PR, Jenkins console, shell history와 이 문서는 opaque slot `A`·`B`, equality attestation, aggregate count·bytes·checksum 결과와 gate 통과 여부만 기록한다.

부분 identifier, truncated identifier와 hashed-prefix identifier도 공개 기록에 남기지 않는다.

## 현재 확인 상태

- Private R2 bucket과 bucket-scoped read/write credential은 제한된 provider store에 준비돼 있다.
- Dedicated Jenkins username/password credential은 Credentials Store에 준비돼 있고 실제 username도 secret으로 취급한다.
- Bucket public access는 provisioning 확인 시점에 비활성화돼 있었다.
- Production environment, backend storage endpoint, MinIO service와 `minio_data` volume은 전환하지 않았다.
- R2 live `Put`, `Get`, `List`, `Delete`, migration copy, rollback drill과 application smoke는 실행하지 않았다.
- Issue [#1113](https://github.com/JNU-SWCU/oss-hub/issues/1113)이 전환 진행의 원본이다.
- PR [#1115](https://github.com/JNU-SWCU/oss-hub/pull/1115)가 non-live R2 deployment contract를 구현했고 required `ci`와 `public-safe`를 통과해 병합됐다.

## 현재 구현 계약

Backend application storage mode는 exact `minio` 또는 `managed`다.

두 mode 모두 `SUBMISSION_FILE_S3_*` tuple을 사용하지만 managed credential 값은 production env file이 아니라 Jenkins masked binding으로만 주입한다.

Managed mode는 account label만 가변인 Cloudflare R2 HTTPS origin, region `auto`, path-style `true`와 private bucket을 요구한다.

Rollback MinIO credential은 `ROLLBACK_MINIO_*`로 분리하며 managed application credential을 재사용하지 않는다.

일반 Release pipeline은 실행 중 backend와 candidate의 non-secret storage tuple hash가 다르면 no-op, backup, build와 backend 재생성 전에 fail-closed로 중단한다.

Configured-endpoint object backup은 mirror parity, 상대경로 SHA-256 manifest, empty-set 검증과 final-path 검증을 통과해야 한다.

`scripts/jenkins/object-storage-migration.sh`는 backend image의 pinned AWS SDK client를 사용하며 `preflight`, `inventory`, `copy-check`, `rollback-drill`, `reverse-copy-check`만 제공한다.

Migration operator는 exact synthetic probe만 삭제할 수 있고 application object overwrite, generic delete, purge와 destructive sync를 제공하지 않는다.

R2 activation 뒤 storage rollback은 항상 writer stop·drain, additive immutable R2→MinIO reverse copy, count·bytes·content SHA-256 parity, MinIO activation, stable-origin smoke 순서다.

## Gate 상태

### G0 — authority와 기록 경계

- [ ] Issue #1113에 execution owner와 rollback approver가 모두 지정됐다.
- [x] Public·restricted two-tier record 경계와 opaque receipt 형식이 정의됐다.
- [x] 현재 production이 pre-A origin + MinIO이고 R2 전환이 실행되지 않았다는 rollback 기준이 기록됐다.

G0가 모두 green이 아니면 provider execution을 시작하지 않는다.

### G1 — prerequisite merge

- [x] PR #1110은 exact green head에서 required checks와 mergeability를 통과해 병합됐다.
- [x] Downstream readiness evidence는 갱신된 main을 기준으로 다시 계산됐다.

### G2 — immutable checkpoint A readiness

- [x] PR #1114의 reviewed readiness SHA가 production Vercel deployment로 배포됐다.
- [x] Provider revision metadata가 reviewed readiness SHA와 일치한다.
- [x] Public homepage, rewritten health와 anonymous session이 same-origin path에서 응답했다.
- [x] AWS frontend와 MinIO rollback material은 그대로 유지된다.

G2는 origin·callback activation 완료를 뜻하지 않는다.

### G3 — Vercel-origin + MinIO activation

- [ ] Jenkins production `FRONTEND_URL`이 stable Vercel production origin과 정확히 같다.
- [ ] GitHub OAuth callback이 같은 origin의 full `/api/v1/auth/github/callback` path와 정확히 같다.
- [ ] Candidate diff가 origin·callback 변경만 포함하고 storage tuple은 MinIO와 동일함을 확인했다.
- [ ] Stable Vercel origin이 canonical이고 AWS frontend가 fallback으로 남아 있다.

Pre-G3 실패는 captured environment와 callback을 복구하고 MinIO와 AWS frontend를 확인한다.

### G4 — checkpoint A smoke

- [ ] Vercel SSR과 `/api/v1` same-origin rewrite가 통과했다.
- [ ] OAuth login·callback·session·logout이 통과했다.
- [ ] Query string, file upload·download·resubmission·delete와 authorization denial이 통과했다.
- [ ] Storage는 전체 smoke 동안 MinIO다.

G4 성공 뒤 origin과 callback은 storage switch와 rollback 동안 바꾸지 않는다.

### G5 — distinct checkpoint B readiness

- [ ] Slot `B`는 `A`와 distinct immutable deployment와 source identity를 가진다.
- [ ] `A`와 `B`의 deployable frontend/config digest는 같다.
- [ ] `A`는 retained·promotable 상태다.
- [x] Non-live Compose, Jenkins, backup, migration와 documentation contract는 reviewed·green이다.

Digest drift는 예외가 아니라 새 `A`를 요구한다.

### G6 — live R2 readiness

- [ ] Actual runtime tuple로 private R2 `Put`, `Get`, `List`, exact probe `Delete`가 통과했다.
- [ ] Selected addressing은 region `auto`와 path-style `true`로 확정됐다.
- [ ] Bucket public access가 계속 비활성화다.
- [ ] Secret·provider identifier leak 검사가 통과했다.
- [ ] Configured-endpoint backup과 restore verification이 통과했다.
- [ ] R2→격리 MinIO rollback drill이 writer state, immutable conflict fail-closed, content parity와 reactivation order를 포함해 통과했다.
- [ ] DB object references와 MinIO inventory가 reconcile됐다.
- [ ] Held server backup과 digest를 복구 가능하게 검증했다.
- [ ] Initial additive immutable copy는 error, conflict와 parity difference가 0이다.
- [ ] Start-free pre-hold receipt가 protected backup과 rollback image를 결박하고 Jenkins cleanup을 차단한다.
- [ ] Rollback approver가 redacted G6 receipt를 확인했다.

G6가 모두 green이 아니면 MinIO가 authoritative이고 R2 activation은 금지된다.

### G7 — stopped-writer storage-only switch

- [ ] Backend writer stop과 drain을 독립적으로 확인했다.
- [ ] Final additive delta copy와 key·size·content SHA-256 parity가 정확하다.
- [ ] Candidate diff는 storage tuple만 바꾸고 origin·callback·frontend/config digest를 바꾸지 않는다.
- [ ] R2-backed backend가 시작되고 health, existing-object read와 configured backup이 통과했다.
- [ ] MinIO는 rollback material로 격리됐고 service·volume·credential은 삭제되지 않았다.
- [ ] Pre-hold protection이 exact backup pruning을 차단하고 rollback image tag를 keep set으로 보호한다.

첫 R2-backed backend start 전 실패는 unchanged `A` + MinIO를 복구한다.

첫 R2-backed backend start 이후 실패는 unconditional reverse-copy-first rollback을 사용한다.

### G8 — checkpoint B와 AWS frontend 제거

- [ ] `B`가 같은 stable Vercel origin에서 full R2 application smoke를 통과했다.
- [ ] Supported maximum-size upload·download, existing-object read, resubmission·delete와 authorization denial이 통과했다.
- [ ] Exact backend-only Release identity와 running revision이 일치한다.
- [ ] Legacy AWS frontend만 volume 없이 제거됐고 AWS API ingress는 계속 healthy다.
- [ ] Removal 뒤 stable-origin smoke를 반복해 통과했다.
- [ ] `A`, MinIO, PostgreSQL, backup과 data volume은 삭제되지 않았다.

G8 전에는 AWS frontend를 제거하지 않는다.

## Pre-hold completion conditions

이 목록은 G9 output인 `ROLLBACK_HOLD_START`를 요구하지 않으며 hold start를 기록하기 전에 모두 green이어야 한다.

- [ ] Issue #1113에 execution owner와 rollback approver가 지정됐다.
- [ ] Topology decision, rollback unit와 public·restricted record boundary가 문서화됐다.
- [ ] Jenkins credential binding과 public-safe leak 검사가 통과했다.
- [ ] Configured-endpoint backup·restore와 ordered isolated rollback drill이 통과했다.
- [ ] Current-object migration inventory, aggregate parity와 content integrity가 통과했다.
- [ ] Private R2 live four-operation preflight가 통과했다.
- [ ] Full application submission-file and authorization smoke가 통과했다.
- [ ] Bucket public access가 비활성화다.
- [ ] Architecture, ADR-002와 server runbook이 G8 production state와 일치한다.

### G9 — receipt, observation와 authoritative hold

- [ ] G8 뒤 Vercel, AWS API/backend/PostgreSQL, R2와 backup error·latency를 최소 30분 관찰했다.
- [ ] Public production receipt가 opaque `A`·`B`, distinct SHA, revision-match, equal frontend/config digest, unchanged provider-project, origin/callback equality, backend Release, aggregate inventory/copy/check, selected path-style, private bucket, backup/restore, rollback drill, smoke, removal, owner·approver와 timestamp attestations을 포함한다.
- [ ] G0–G8, 30분 observation과 pre-hold completion conditions가 동시에 green이다.
- [ ] 위 조건이 동시에 green이 된 UTC instant 하나를 execution owner가 `ROLLBACK_HOLD_START`로 기록하고 rollback approver가 countersign했다.
- [ ] Jenkins hold receipt가 같은 start, 정확히 start + 72h인 expiry, pre-hold와 동일한 protected backup·rollback image를 참조한다.
- [ ] Hold receipt validation이 통과한 뒤에만 start-free pre-hold receipt를 제거했다.

R2 start, B promotion, Release publication과 observation 시작 시각은 `ROLLBACK_HOLD_START`가 아니다.

## 72시간 hold와 cleanup

`ROLLBACK_HOLD_START` 전에는 attended cutover가 generic Release를 금지하고 pre-cutover backup, MinIO와 slot `A`를 삭제하지 않는다.

G7 전 start-free pre-hold receipt는 protected backup과 rollback image identity만 기록하며 alternate hold epoch가 아니다.

Jenkins는 모든 retention cleanup 전에 pre-hold receipt를 검증하고 exact backup pruning을 건너뛰며 rollback image tag를 keep set에 넣는다. 검증 뒤 bounded cache와 unrelated image cleanup은 허용하고 hold receipt 전환 시 두 receipt의 identity가 같은지 fail-closed로 확인한다.

Hold expiry 전에는 slot `A`, Vercel-origin + MinIO rollback environment, isolated MinIO services·data·config, held server backup과 digest, inventories와 previous backend image를 유지한다.

R2 write 뒤 MinIO rollback은 zero-delta여도 `reverse-copy-check`를 실행한 검증 결과로만 no-op을 증명한다.

Hold expiry는 cleanup eligibility일 뿐 authorization이 아니다.

Expiry 뒤 final recovery verification과 별도 reviewed cleanup approval가 같은 `ROLLBACK_HOLD_START`를 참조할 때까지 Jenkins는 protected backup과 rollback image retention을 해제하지 않는다.

Approval 뒤 cleanup은 별도 reviewable change로 MinIO service, volume, credential, AWS frontend compatibility와 migration-only Jenkins branches를 제거한다.

Cleanup 뒤 managed R2만 application object storage로 남는다.

## 완료 조건

다음 항목을 모두 충족하기 전에는 R2 cutover를 `done`으로 기록하지 않는다.

- [ ] G0–G9가 모두 green이다.
- [ ] Pre-hold completion conditions가 모두 green이다.
- [ ] Complete opaque production receipt와 countersigned `ROLLBACK_HOLD_START`가 Issue #1113 또는 dedicated PR에 남았다.
- [ ] Jenkins hold receipt의 authoritative start, exact expiry, protected backup·image validation이 통과했다.

누락 checkbox는 documentation follow-up이 아니라 open cutover다.

## 근거 링크

- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 S3 getting started](https://developers.cloudflare.com/r2/get-started/s3/)
- [R2 cutover Issue #1113](https://github.com/JNU-SWCU/oss-hub/issues/1113)
- [R2 readiness contract PR #1115](https://github.com/JNU-SWCU/oss-hub/pull/1115)
