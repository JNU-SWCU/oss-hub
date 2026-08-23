---
slug: ADR-002-CI-CD-파이프라인
date: 2026-07-11
author: GoBeromsu
status: Accepted
references:
  - ADR-001-테크스택
refines: []
---

# ADR-002: CI/CD 파이프라인

## Status

Accepted

> **Rollout 완료.** 운영 job은 main의 root `Jenkinsfile` 하나를 읽고, 파라미터 없이 latest full Release를 배포한다. `RUN_MODE`·영속 배포 상태 파일·SHA 이미지 태그·병행 pipeline 정의는 제거됐다. v0.3.1 배포와 독립 no-op 재실행이 Jenkins에서 성공했다. 추적: [#305](https://github.com/JNU-SWCU/oss-hub/issues/305)

## Date

2026-07-11

## Context

PR 품질 검증은 필요하지만 CI에서 Docker 이미지를 빌드하면 실행 시간과 과금이 늘어난다. 또한 브랜치 보호의 required check는 PR마다 항상 보고되어야 하며, 경로 조건으로 job 자체가 생략되면 병합 대기 상태가 교착될 수 있다. 배포 서버에는 레지스트리 없이 Docker를 실행하며, 실패 시 직전 배포로 복구할 수 있어야 한다. 초기 배포에는 직전 이미지가 없는 greenfield 상태도 존재한다.

## Decision

GitHub Actions는 모든 PR에서 실행되는 경량 CI로 구성하고 required job 이름을 항상 `ci`로 유지한다. `ci` job 내부에서 paths gate를 처리하여 대상 변경이 없더라도 job 결과를 보고한다. CI는 lint, typecheck, test, 앱 build를 수행하고 Docker 이미지 빌드는 수행하지 않는다. 병합 게이트는 ADR-005에 따라 required check(`ci`·`public-safe`)의 실제 통과와 GitHub mergeable 상태뿐이다.

main 병합은 GitHub Actions `ci`가 검증하며 Jenkins는 production 배포만 담당한다.
production 배포 후보 단위는 공개 GitHub Release다.
main 이력의 exact commit을 가리키는 tag로 draft·prerelease가 아닌 Release를 발행하면 `release.published` 이벤트가 `deploy.yml`을 직접 실행한다.
`deploy.yml`은 그 published 이벤트에서 별도 feature flag 없이 Jenkins 내장 원격 빌드 트리거(전용 서비스 사용자 API token Basic 인증)로 **파라미터 없는 POST**를 보내며, 트리거 실패는 같은 GitHub Actions run을 재실행해 복구한다.
별도 `release.yml`·`workflow_call`·수동 deploy dispatch 표면은 두지 않는다. 트리거 URL은 HTTPS만 허용한다. 배포 서버의 host nginx가 공인 IP TLS를 종료하고 해당 경로의 POST만 localhost Jenkins로 리버스 프록시하며 Jenkins UI는 공개하지 않는다. 나머지 요청은 loopback `127.0.0.1:8081`의 Compose nginx로 전달한다. GitHub Actions는 얇은 트리거 POST만 담당하고 검증·배포·실패 알림은 Jenkins가 수행한다. Jenkins는 트리거로부터 버전을 전달받지 않고 **자체적으로 현재 latest full Release를 조회**해 `draft=false`·`prerelease=false`와 full SemVer tag를 확인한다.
tag가 가리키는 정확한 commit SHA가 main 이력에 포함될 때만 해당 SHA를 checkout한다.
**배포 인가는 draft·prerelease가 아닌 GitHub Release의 발행 자체다** — 누가 배포를 시작할 수 있는지는 GitHub의 Release 발행 권한이 통제하고, Jenkins는 인가 주체를 따로 판별하지 않는다.
공개 댓글 marker 승인 게이트(`RELEASE_ACCEPT`·`RELEASE_OVERRIDE`)는 폐지한다 — 권한 통제를 이미 가진 플랫폼 위에 별도 문자열 파싱 게이트를 얹으면 실패 지점만 늘고 인가 주체는 그대로다.
별도 staging 서버는 두지 않는다.

Jenkins는 매 실행에서 최신 Release로 수렴하는 멱등 작업이다. 현재 실행 중인 컨테이너의 이미지 태그를 조회해 대상 Release와 같거나 대상이 더 낮으면 성공 no-op 처리한다. Jenkins는 exact `RELEASE_SHA`를 해석한 직후 GitHub Actions REST API로 그 SHA의 `ci` job이 `event=push`로 `success`했는지 확인하고, job이 없거나 실패했거나 `issues`·`issue_comment` 등 push가 아닌 이벤트로만 통과한 경우 배포를 fail-closed로 거절한다(`scripts/jenkins/validate-ci-status.sh`). **배포 시점 재검증(lint·typecheck·test·앱 build)은 폐지했다** — 품질 검증 책임은 전부 CI 레이어(merge 전 `ci` required check)에 있고, Jenkins는 그 검증이 이미 exact 배포 대상 커밋에서 green으로 끝났다는 사실만 이 게이트로 확인한다. 새 Release는 PostgreSQL backup → object backup → 서버 로컬 frontend/backend 이미지 1회 build → `prisma migrate deploy` → `up -d --no-build --wait` → smoke 순서로 배포한다. 이미지 build는 각 Dockerfile 내부에서 자체적으로 `pnpm install --frozen-lockfile`·`prisma generate`·`pnpm build`를 수행하므로 별도 host 단계에서 이를 반복할 필요가 없다.
smoke는 rollout과 rollback의 Compose ingress에서 `/` 200과 `/api/v1/health` 200을 단언하며, 제출 파일 차단 해제 뒤에는 미인증 접근 401과 인증 접근의 정상 동작을 단언한다. 제출 파일 접근의 구체적인 단언 문구는 구현 PR이 정한다.
`/api/v1/health`는 PostgreSQL 연결을 실제로 확인하고 DB에 닿지 못하면 503을 반환한다 — 상수 응답은 nginx와 Node 프로세스가 살아 있다는 것만 증명하므로 배포 판정 근거가 되지 못한다.
이미지는 release tag로 태깅하므로 별도 영속 배포 상태 파일을 두지 않으며, 배포 상태의 원본은 실행 중인 컨테이너 자신이다. 서비스 교체 또는 smoke가 실패하면 `PREV_TAG` 이미지로 한 번 rollback한다. 배포 전에는 운영 환경 파일의 `FRONTEND_URL`이 `https://`인지 확인한다. DB restore는 자동화하지 않고 보존한 backup을 사용해 사람이 승인한 수동 복구로 남긴다. `down -v`는 사용하지 않으며 PostgreSQL 데이터는 named volume `pgdata`에, 제출 파일 object data는 named volume `minio_data`에 보존한다.

### Anti-pattern: 애플리케이션 권한 검증을 CD에 두기

CD는 애플리케이션 persona나 authorization matrix를 이해하지 않는다.
CD는 synthetic user를 만들거나 일회용 domain state를 seed하지 않는다.
CD는 CI acceptance test를 복제하지 않는다.
이 검증은 CI 또는 pre-release verification의 책임이다.
CD는 immutable release/image identity, backup, migration, rollout, infrastructure health/smoke, rollback을 담당한다.
Builds #160/#161은 verified release가 있어도 test artifact 또는 domain fixture가 없으면 production deployment가 막히는 failure mode를 보였다.
이 결합은 CD를 CI와 application state에 종속시키므로 auth matrix gate를 CD에서 제거한다.

배포가 성공한 **뒤에만** 이미지와 backup을 정리한다. 실행 중인 이미지와 직전 성공 배포 이미지는 rollback 대상이므로 절대 삭제하지 않고, 그보다 이전 이미지만 제거한다. 개수가 아니라 이 보존 규칙이 판단 기준이다. PostgreSQL과 object backup은 같은 `BACKUP_DIR`에 저장하고 같은 `BACKUP_RETENTION_N` 보존 규율을 적용한다. 보존 값은 실측한 backup 크기·증가율·가용 예산·최대 배포 빈도·복구 보존 기간으로 산정해 승인 기록에 남긴다. 값이 확정되기 전에는 정리를 수행하지 않는다(fail-closed).

## Alternatives considered

### CI에서 Docker 이미지 빌드

- Pros: 컨테이너 빌드 정의를 PR 단계에서 검증할 수 있다.
- Cons: CI 실행 시간과 과금이 증가하고, 애플리케이션 품질 검증과 중복되는 작업이 많다.
- **Rejected:** lint, typecheck, test, 앱 build로 필요한 빠른 피드백을 제공하고 이미지 빌드는 배포 서버에서 한 번만 수행한다.

### 레지스트리 기반 배포

- Pros: 이미지 이동과 배포 이력 관리가 표준화된다.
- Cons: 레지스트리 운영·권한·전송 비용과 추가 설정이 필요하다.
- **Rejected:** 단일 배포 서버에서는 release tag로 태깅한 서버 로컬 빌드가 더 단순하고 비용을 줄인다.

## Consequences

### Enables

- 모든 PR에서 `ci` required check가 보고되어 브랜치 보호 교착을 피한다.
- Docker 이미지 빌드 과금을 CI에서 제거하고 배포당 한 번으로 제한한다.
- release tag 이미지와 `PREV_TAG`로 배포 및 rollback 대상을 명확히 식별하며, tag와 이미지가 같은 이름 공간을 쓰므로 별도 매핑 상태를 유지하지 않는다.
- draft·prerelease가 아닌 GitHub Release 발행 한 번이 배포 인가이며, 인가 주체 통제는 GitHub의 Release 발행 권한이 담당한다. 배포를 시작하려는 사람이 저장소 밖 문자열 규약을 외울 필요가 없다.
- 동일·하위 Release 재전달은 no-op이므로 webhook 재전송이 중복 배포로 이어지지 않는다.
- smoke는 제출 파일 차단 해제 뒤 미인증 접근 401과 인증 접근의 정상 동작을 Compose ingress에서 직접 단언하므로 접근 제어와 정상 경로가 배포마다 증명된다.
- `/api/v1/health`가 PostgreSQL 연결을 확인하므로 DB에 닿지 못하는 배포가 smoke를 통과하지 못한다.

### Costs / trade-offs

- Jenkins와 배포 서버의 webhook, Docker, Compose 운영 책임이 생긴다.
- 배포 인가 기록이 저장소 안 댓글이 아니라 GitHub Release 발행 이력과 audit log에 남는다. 누가 어떤 tag를 배포했는지 알려면 저장소가 아니라 GitHub Release·감사 로그를 본다.
- Release 발행 권한을 가진 사람은 별도 절차 없이 production을 바꿀 수 있다. 이 권한 목록 관리가 배포 통제의 실체이므로 협업자 권한 부여가 배포 권한 부여와 같은 무게를 갖는다.
- 로컬 빌드 이미지는 서버 밖에서 재사용되지 않으며, greenfield 실패는 자동 rollback할 수 없다.
- migration 이후의 DB restore는 자동 rollback 범위 밖이므로 backup 확인과 수동 복구 책임자가 필요하다.

### New constraints

- GitHub Actions required job 이름은 반드시 `ci`이고 모든 PR에서 보고되어야 한다.
- 경로별 검증 대상과 synthetic-only 경계는 [CI 경로별 검증 계약](../rules/ci-path-verification.md)을 따른다.
- Jenkins는 production 배포만 담당하고 main 검증은 GitHub Actions `ci`가 단독으로 수행한다. Jenkins는 현재 latest full GitHub Release만 처리한다.
- production 배포 트리거는 GitHub Actions `deploy.yml`이 draft·prerelease가 아닌 published 이벤트에서 HTTPS Jenkins 내장 원격 트리거(전용 서비스 사용자 API token)로 파라미터 없이 보낸다. 트리거 경로에는 사람·환경변수 게이트를 두지 않는다. 공개 표면은 `POST /job/oss-hub-release-cd/build` 정확일치 경로 하나뿐이며 host nginx가 그 경로의 POST만 프록시한다. 배포 대상 판별은 트리거 입력이 아니라 Jenkins의 latest Release 조회가 담당하며, draft·prerelease·full SemVer가 아닌 tag는 그 조회 결과를 근거로 Jenkins가 거절한다. 트리거 엔드포인트·API token 값은 GitHub repo secret에만 두고 저장소·로그에 남기지 않는다.
- 배포 실패 알림은 Jenkins email-ext 플러그인으로 보내며 수신자·SMTP는 Jenkins UI 설정(Manage Jenkins → System → Extended E-mail Notification의 Default Recipients + SMTP)에만 두고 저장소에 이메일 주소를 남기지 않는다.
- 배포 인가는 draft·prerelease가 아닌 GitHub Release 발행이며 Jenkins는 별도 승인 marker를 요구하지 않는다. 인가 주체 통제는 GitHub의 Release 발행 권한이 담당하므로 그 권한 목록이 배포 권한 목록이다.
- tag commit은 main ancestry를 통과한 exact SHA여야 한다. 태그 조작 방어는 세 가지 fail-closed 검사의 합이다: Jenkins가 자체 조회한 latest full Release만 대상으로 삼고, tag는 full `vMAJOR.MINOR.PATCH`여야 하며, 그 tag가 가리키는 exact SHA가 main 이력에 포함되어야 한다. 실행 중 SemVer가 같거나 더 높으면 no-op이라 임의 tag 재작성으로 하위 버전을 밀어 넣을 수 없다. 영속 배포 상태 파일은 두지 않으며 판정 근거는 실행 중인 컨테이너 label이다.
- Jenkins는 Docker 권한을 가진 `oss-hub-production` 전용 executor에서만 실행하고 동시 실행을 금지한다. 운영 환경 파일은 Credentials Store의 file credential로 실행 시점에만 주입한다. GitHub App 개인키도 같은 방식의 file credential로 주입하되 env 값이 아니라 파일로 전달한다 — env 값은 `docker compose config`·`docker inspect`·프로세스 env 덤프에 평문으로 드러난다. 파이프라인은 주입받은 키를 `SECRETS_DIR` 아래 build별 generation 디렉터리에 `0640`으로 설치하고 `current` symlink를 원자 교체하며, compose는 그 경로를 secret source로 읽는다. 설치는 compose를 처음 호출하는 stage보다 앞에 있어야 한다.
- Compose는 `COMPOSE_PROJECT_NAME`을 고정하며 `pgdata`와 기존 데이터를 삭제하는 `down -v`를 사용하지 않는다.
- host nginx만 공인 80/443을 열고 약 6일 유효한 Let's Encrypt IP 인증서를 종료한다. Compose nginx는 `127.0.0.1:8081`에만 bind하여 `/`를 front로, `/api`를 back으로 라우팅하고 `/api/v1` 접두사는 제거하지 않는다. 런타임은 nginx, front, back, postgres와 제출 파일 object storage(`minio` 지속 서비스, `minio-bucket` 초기화 서비스)로 구성된다.
- Compose nginx의 설정은 **디렉터리 마운트**(`./deploy/nginx:/etc/nginx/conf.d:ro`)로 주입한다. 단일 파일 bind mount는 컨테이너 생성 시점의 inode를 고정하는데 Jenkins는 배포마다 git checkout으로 그 파일을 교체하므로, 수명이 긴 nginx 컨테이너가 저장소와 무관한 옛 설정을 계속 서빙한다. 디렉터리를 마운트하면 컨테이너가 매번 현재 파일을 읽는다.
- 저장소 파일만 읽는 검사는 실행 중 설정이 저장소와 같다는 증거가 되지 못한다. 실행 중 설정에 대한 계약은 Compose ingress를 실제로 호출하는 배포 smoke가 증명한다.
- 배포 smoke는 rollout과 rollback의 Compose ingress에서 `/` 200과 `/api/v1/health` 200을 단언하며, 제출 파일 차단 해제 뒤에는 미인증 접근 401과 인증 접근의 정상 동작을 단언한다. 제출 파일 접근의 구체적인 단언 문구는 구현 PR이 정하며, `/api/v1/health`는 PostgreSQL 연결을 실제로 확인하고 닿지 못하면 503을 반환한다 — 상수 200은 배포 판정 근거가 아니다.
- 제출 파일 object data는 `minio_data` volume에 있으며, Jenkins는 PostgreSQL backup과 같은 `BACKUP_DIR`에 object backup을 저장하고 같은 `BACKUP_RETENTION_N` 보존 규율을 적용한다. object backup 실패는 배포를 fail-closed로 중단한다. Compose nginx의 제출 파일 차단은 off-host object backup과 [배포 런북](../deploy/server-runbook.md)의 restore drill을 완료한 뒤 별도 high-risk 변경으로만 해제한다.
- Certbot 5.4 이상의 `shortlived` IP 인증서를 webroot로 자동 갱신하고 성공한 갱신 뒤 host nginx를 reload한다. 인증서 갱신 실패는 만료 전 운영 경보 대상이다.

## Changelog

- 2026-08-04: `event=push` `ci` job green 게이트(#596, `scripts/jenkins/validate-ci-status.sh`)를 root `Jenkinsfile`에 먼저 병합해 fail-closed로 활성화하고, 실제 배포로 게이트를 양방향 증명한 **뒤에** 배포 시점 재검증 stage(`빌드·테스트 검증`: `pnpm install --frozen-lockfile`·`prisma generate`·lint·typecheck·test·build)를 제거했다. 증명: (1) `ci` 미완료 상태로 병합된 사고 커밋 `8cdbe05`는 게이트가 거절, (2) `ci` green이 확인된 `32da8e3e`는 Release `v0.6.24`로 Jenkins 빌드 #58이 SUCCESS(5분 18초) 처리했고 빌드 로그에 `CI_STATUS_GATE=ok run_id=30884101311 conclusion=success`가 남았으며 배포 호스트의 실행 컨테이너(backend·frontend)가 `v0.6.24` 이미지로 확인됐다. 두 Dockerfile(`apps/backend`, `apps/frontend`)이 각자 `pnpm install --frozen-lockfile`·`prisma generate`·`pnpm build`를 이미지 build 단계 안에서 독립적으로 수행하므로 host 단계의 반복 실행은 애초에 불필요했다. 순서를 반대로 했다면(게이트보다 재검증 stage 제거가 먼저였다면) 게이트가 실증되지 않은 상태에서 그 창(window) 동안 무검증 커밋이 배포될 수 있었으므로, 게이트를 실배포로 증명하기 전까지는 이 stage 제거 변경을 준비만 하고 병합하지 않았다.
- 2026-08-04: ADR-005의 `MERGE_READY` 코멘트 프로토콜·`merge-policy` 판정기 삭제에 맞춰 병합 검토 문장을 갱신했다 — 병합 게이트는 required check(`ci`·`public-safe`)의 실제 통과와 GitHub mergeable 상태뿐이다.
- 2026-08-03: 제출 파일 object backup을 PostgreSQL backup과 같은 `BACKUP_DIR`·`BACKUP_RETENTION_N` 규율의 fail-closed 배포 단계로 편입했다. Compose nginx 차단 해제는 off-host object backup과 배포 런북의 restore drill 완료 뒤 별도 high-risk 변경으로 제한하고, 해제 뒤 smoke는 업로드 경로 403 대신 미인증 401과 인증 정상 동작을 구현 PR이 정한 문구로 단언하도록 계약을 갱신했다.
- 2026-07-29: v0.4.1 Release의 `published` 이벤트 → `deploy.yml` → parameterless Jenkins #27 → production health까지 자동 왕복을 실증하고, 존재하지 않는 `release.yml`·`workflow_call`·수동 deploy dispatch 목표를 제거해 최종 운영 경로에 수렴했다.
- 2026-07-29: root `Jenkinsfile` 단일 parameterless Release pipeline 전환 완료. v0.3.1 실제 배포, loopback/TLS health, 독립 no-op 재실행을 확인하고 legacy pipeline·병행 `Jenkinsfile.v2`·이중 checker mode를 제거했다.
- 2026-07-28: 배포 트리거에서 파라미터를 제거하고 Jenkins가 latest Release를 자체 조회하도록 계약을 전환. 이미지 태그를 release tag로 통일하고 영속 배포 상태 파일과 `RUN_MODE` 분기를 폐기했으며, 태그 조작 방어의 원본이 `RELEASE_ACCEPT role=PM` 승인 바인딩임을 명시. 릴리즈 발행(`release.yml`)과 배포 트리거(`deploy.yml`)를 분리해 배포 단독 재시도를 허용. 이 개정은 목표 상태를 기술하며 구현은 [#305](https://github.com/JNU-SWCU/oss-hub/issues/305)의 후속 PR에서 순차 진행된다.
- 2026-07-28: Issue #199에 따라 production 배포 승인을 @GoBeromsu 단독 `RELEASE_ACCEPT role=PM`으로 전환하고 `RELEASE_ACCEPT role=TECH_LEAD`와 `RELEASE_OVERRIDE role=PM`을 폐지했다.
- 2026-07-25: v0.1.2 live rollout에서 Nest 산출물이 `dist/src/main.js`인데 backend image CMD가 `dist/main.js`를 실행해 실패한 것을 확인하고, runtime entrypoint와 static contract를 실제 산출물에 정렬.
- 2026-07-25: v0.1.1 live build에서 재사용 Jenkins workspace의 `pnpm install`이 postinstall을 재실행하지 않아 stale Prisma client로 lint 실패한 것을 확인하고, 검증 stage에 명시적 `prisma generate` 추가.
- 2026-07-25: PM이 승인 대기를 중단하고 즉시 production 진행을 명시한 경우를 위해 exact tag·SHA의 공개 `RELEASE_OVERRIDE role=PM` 예외 경로를 추가. 기본 PM·Tech Lead 이중 승인은 유지.
- 2026-07-25: Jenkins CSRF live probe 결과에 따라 job build token을 전용 `oss-hub-deployer` API token Basic 인증으로 교체하고 exact POST 공개 경계를 유지.
- 2026-07-25: 공인 EIP `54.116.116.174`의 host nginx TLS 종단, loopback Compose ingress, short-lived IP 인증서 자동 갱신 계약을 추가하고 내부·TLS smoke를 분리.
- 2026-07-24: production 배포 트리거를 서명 release webhook에서 GitHub Actions(`deploy.yml`)→Jenkins 내장 원격 트리거(nginx 리버스 프록시·빌드 토큰)로 전환하고 배포 실패 알림을 email-ext(`$DEFAULT_RECIPIENTS`)로 추가. `RELEASE_ACCEPT` 승인 게이트는 유지 (배포 트리거 전환 PR)
- 2026-07-23: GitHub Release를 배포 후보로 명확히 하고 같은 tag·SHA의 PM·Tech Lead 이중 `RELEASE_ACCEPT`를 production 사람 승인 지점으로 확정 (#225)
- 2026-07-22: production 승인 단위를 GitHub Release로 전환하고 main 검증 전용·exact SHA·no-op·backup·수동 DB 복구 계약 추가 (#199)
- 2026-07-16: 경로별 검증 계약 링크 추가
- 2026-07-11: initial decision

## References

- [GitHub Actions](https://docs.github.com/actions)
- [Jenkins Pipeline](https://www.jenkins.io/doc/book/pipeline/)
- [Docker Compose](https://docs.docker.com/compose/)
