# Cloudflare R2 운영 준비 인수인계

> 기준 시각: 2026-09-02 KST
>
> 이 문서는 private Cloudflare R2 전환의 canonical G0–G9 gate와 완료 조건을 소유한다.
>
> 현재 production frontend origin은 canonical custom domain이고 application object storage는 private managed R2다.
>
> 완료 영수증은 Issue #1113의 opaque receipt이며, 이 문서는 그 실행을 gate별로 기록한다.

## 실행 기록 (2026-09-02)

R2 cutover는 2026-09-02(KST)에 owner의 명시적 beta-speed go 아래 완료됐다. Storage는 private managed R2, 공개 ingress는 API 전용(비API 308 → canonical), receipt는 Issue #1113, owner waiver 뒤 cleanup까지 완료됐다. 아래 checklist의 `deviation` 표기는 owner license로 수용된 절차 대체를 뜻한다.

## 공개 저장소 보안 경계

실제 Cloudflare account identifier, endpoint, access key, secret key, bucket identifier, object key, inventory, manifest, immutable provider deployment identifier, Jenkins 내부 주소와 machine path는 제한된 provider/operator store만 소유한다.

GitHub Issue, PR, Jenkins console, shell history와 이 문서는 opaque slot `A`·`B`, equality attestation, aggregate count·bytes·checksum 결과와 gate 통과 여부만 기록한다.

부분 identifier, truncated identifier와 hashed-prefix identifier도 공개 기록에 남기지 않는다.

## 현재 확인 상태 (2026-09-02)

- Application object storage는 private managed R2이며 backend는 managed tuple로 실행 중이다.
- Dedicated Jenkins username/password credential이 managed 배포·백업에 사용되고 실제 username도 secret으로 취급한다.
- Bucket public access는 계속 비활성화다.
- Production MinIO service·volume·credential, hold branch와 legacy frontend 컨테이너는 owner waiver 뒤 제거됐다.
- Live `Put`·`Get`·`List`, stopped-writer copy와 SHA-256 parity, 결손 12건 restore, checkpoint B smoke가 실행·통과됐다(수용 deviation은 실행 기록 절 참조).
- Issue [#1113](https://github.com/JNU-SWCU/oss-hub/issues/1113)이 전환 기록의 원본이다.
- PR [#1115](https://github.com/JNU-SWCU/oss-hub/pull/1115)가 non-live R2 deployment contract를 구현했고 required `ci`와 `public-safe`를 통과해 병합됐다.

## 현재 구현 계약

Production backend application storage mode는 exact `managed`다.

일반 Release pipeline은 실행 중 backend와 candidate의 non-secret storage tuple hash가 다르면 no-op, backup, build와 backend 재생성 전에 fail-closed로 중단한다.

Managed credential은 production env file이 아니라 Jenkins masked binding으로만 주입한다. Endpoint는 account label만 가변인 Cloudflare R2 HTTPS origin, region은 `auto`, path-style은 `true`이며 bucket은 private다.

Configured-endpoint object backup은 pinned backend image의 AWS SDK client로 실행하고 상대경로 SHA-256 manifest, empty-set 검증과 final-path 검증을 통과해야 한다.

Rollback은 captured previous backend image ID·version·revision이 exact match할 때만 허용한다. Production storage mode를 MinIO로 되돌리는 경로는 없다.

## Gate 상태

### G0 — authority와 기록 경계

- [x] Deviation: owner(@GoBeromsu)가 execution·rollback 권한을 겸하며 명시적 go로 승인했다.
- [x] Public·restricted two-tier record 경계와 opaque receipt 형식이 정의됐다.
- [x] 당시 production이 pre-A origin + MinIO였다는 rollback 기준이 기록됐다(현재는 cutover 완료).

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

- [x] Jenkins production `FRONTEND_URL`이 stable Vercel production origin과 정확히 같다.
- [x] GitHub OAuth callback이 같은 origin의 full `/api/v1/auth/github/callback` path와 정확히 같다.
- [x] Candidate diff가 origin·callback 변경만 포함하고 storage tuple은 MinIO와 동일함을 확인했다.
- [x] Stable Vercel origin이 canonical이고 AWS frontend가 fallback으로 남아 있다.

Pre-G3 실패는 captured environment와 callback을 복구하고 MinIO와 AWS frontend를 확인한다.

### G4 — checkpoint A smoke

- [x] Vercel SSR과 `/api/v1` same-origin rewrite가 통과했다.
- [x] OAuth login·callback·session·logout이 통과했다.
- [x] Query string과 authorization denial이 통과했다 — deviation: file write smoke는 no-user-token-write 규칙과 beta license로 제외했고 저장 경로는 boot validation·G7 parity가 대체 증거다.
- [x] Storage는 전체 smoke 동안 MinIO다.

G4 성공 뒤 origin과 callback은 storage switch와 rollback 동안 바꾸지 않는다.

### G5 — distinct checkpoint B readiness

- [x] Slot `B`는 `A`와 distinct immutable deployment와 source identity를 가진다.
- [x] `A`와 `B`의 deployable frontend/config digest는 같다.
- [x] `A`는 retained·promotable 상태다.
- [x] Non-live Compose, Jenkins, backup, migration와 documentation contract는 reviewed·green이다.

Digest drift는 예외가 아니라 새 `A`를 요구한다.

### G6 — live R2 readiness

- [x] Actual runtime tuple로 private R2 `Put`, `Get`, `List`가 copy-check·restore로 실증됐다 — deviation: exact probe `Delete`는 beta license로 생략했다.
- [x] Selected addressing은 region `auto`와 path-style `true`로 확정됐다.
- [x] Bucket public access가 계속 비활성화다.
- [x] Secret·provider identifier leak 검사가 통과했다.
- [x] Configured-endpoint backup(SDK 전수 다운로드)과 restore(결손 12건 백업 복구)가 실증됐다.
- [x] R2→MinIO rollback 경로는 `reverse-copy-check` 계약과 synthetic test로 검증됐다 — deviation: live drill은 beta license로 생략했다.
- [x] DB object references와 MinIO inventory가 reconcile됐다.
- [x] Held server backup과 digest를 복구 가능하게 검증했다.
- [x] Initial additive immutable copy는 error, conflict와 parity difference가 0이다.
- [x] Deviation: pre-hold receipt는 beta license로 생략했고 cutover 직후 authoritative hold receipt가 같은 보호를 제공한다.
- [x] Deviation: owner의 명시적 cutover go가 approver 확인을 대체했다.

G6가 모두 green이 아니면 MinIO가 authoritative이고 R2 activation은 금지된다.

### G7 — stopped-writer storage-only switch

- [x] Backend writer stop과 drain을 독립적으로 확인했다.
- [x] Final additive delta copy와 key·size·content SHA-256 parity가 정확하다.
- [x] Candidate diff는 storage tuple만 바꾸고 origin·callback·frontend/config digest를 바꾸지 않는다.
- [x] R2-backed backend가 시작되고 health, existing-object read와 configured backup이 통과했다.
- [x] MinIO는 rollback material로 격리됐고 service·volume·credential은 삭제되지 않았다.
- [x] Deviation: 사후 기록한 hold receipt가 exact backup pruning 차단과 rollback image keep-set 보호를 제공한다(validator `protected` 상태 확인).

첫 R2-backed backend start 전 실패는 unchanged `A` + MinIO를 복구한다.

첫 R2-backed backend start 이후 실패는 unconditional reverse-copy-first rollback을 사용한다.

### G8 — checkpoint B와 AWS frontend 제거

- [x] `B`가 같은 canonical origin에서 SSR·OAuth·session·query·authz smoke를 통과했다 — deviation: file write는 제외.
- [x] Existing-object read(SDK 실증)와 authorization denial이 통과했다 — deviation: max-size upload·resubmission·delete는 beta license로 제외.
- [x] Exact backend-only Release identity와 running revision이 일치한다.
- [x] Legacy AWS frontend만 volume 없이 제거됐고 AWS API ingress는 계속 healthy다.
- [x] Removal 뒤 stable-origin smoke를 반복해 통과했다.
- [x] `A`, MinIO, PostgreSQL, backup과 data volume은 삭제되지 않았다.

G8 전에는 AWS frontend를 제거하지 않는다.

## Pre-hold completion conditions

이 목록은 G9 output인 `ROLLBACK_HOLD_START`를 요구하지 않으며 hold start를 기록하기 전에 모두 green이어야 한다.

- [x] Deviation: owner(@GoBeromsu)가 execution·rollback 권한을 겸하며 명시적 go로 승인했다.
- [x] Topology decision, rollback unit와 public·restricted record boundary가 문서화됐다.
- [x] Jenkins credential binding과 public-safe leak 검사가 통과했다.
- [x] Configured-endpoint backup·restore가 실증됐다 — deviation: live drill은 생략, reverse-copy-check 계약이 대체한다.
- [x] Current-object migration inventory, aggregate parity와 content integrity가 통과했다.
- [x] Private R2 live Put·Get·List가 실증됐다 — deviation: probe Delete는 생략했다.
- [x] Application query·authz·existing-file smoke가 통과했다 — deviation: file write는 제외.
- [x] Bucket public access가 비활성화다.
- [x] Architecture, ADR-002와 server runbook이 G8 production state와 일치한다.

### G9 — receipt, observation와 authoritative hold

- [x] Cutover 뒤 2시간 이상 canonical health·API·storage 동작을 반복 확인했다 — deviation: 형식화된 30분 관찰 창 대신 반복 probe로 대체했다.
- [x] Public production receipt가 Issue #1113에 opaque 형식으로 발행됐다(2026-09-02).
- [x] Deviation: 순차 실행으로 각 gate green을 확인했고 동시성 요구는 beta license로 완화됐다.
- [x] 단일 `ROLLBACK_HOLD_START`가 hold receipt에 기록됐다 — deviation: countersign은 owner go가 대체했다.
- [x] Jenkins hold receipt가 같은 start, 정확히 start + 72h인 expiry, pre-hold와 동일한 protected backup·rollback image를 참조한다.
- [x] 해당 없음: pre-hold receipt는 생략됐고 hold receipt validation은 `protected` 상태를 반환했다.

R2 start, B promotion, Release publication과 observation 시작 시각은 `ROLLBACK_HOLD_START`가 아니다.

## Hold waiver와 cleanup 완료

Owner는 2026-09-02 KST에 남은 hold 대기를 명시적으로 면제했다. Fresh managed object backup과 generic Release success를 확인한 뒤 production MinIO containers·volume·pre-cutover backup, hold state machine, rollback credentials와 AWS frontend runtime을 제거했다. Production에는 managed R2, backend, PostgreSQL과 API-only ingress만 남는다. Local development substitutes는 production 계약과 분리된다.

## 완료 조건

다음 항목을 모두 충족하기 전에는 R2 cutover를 `done`으로 기록하지 않는다.

- [x] G0–G9가 위 명시된 deviation과 함께 green이다.
- [x] Pre-hold completion conditions가 위 deviation과 함께 green이다.
- [x] Opaque production receipt가 Issue #1113에 남았고 `ROLLBACK_HOLD_START`는 Jenkins hold receipt가 보유한다.
- [x] Jenkins hold receipt validation이 `protected` 상태를 반환했다(canonical validator 실행).

누락 checkbox는 documentation follow-up이 아니라 open cutover다.

## 근거 링크

- [Cloudflare R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 S3 getting started](https://developers.cloudflare.com/r2/get-started/s3/)
- [R2 cutover Issue #1113](https://github.com/JNU-SWCU/oss-hub/issues/1113)
- [R2 readiness contract PR #1115](https://github.com/JNU-SWCU/oss-hub/pull/1115)
