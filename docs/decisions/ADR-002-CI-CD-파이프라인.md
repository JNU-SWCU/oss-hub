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

GitHub Actions는 모든 PR에서 실행되는 경량 CI로 구성하고 required job 이름을 항상 `ci`로 유지한다. `ci` job 내부에서 paths gate를 처리하여 대상 변경이 없더라도 job 결과를 보고한다. CI는 lint, typecheck, test, 앱 build를 수행하고 Docker 이미지 빌드는 수행하지 않는다. 병합 검토는 ADR-005의 exact-head `MERGE_READY`와 high-risk 단일 accept 계약을 따른다.

main 병합은 GitHub Actions `ci`가 검증하며 Jenkins는 production 배포만 담당한다. production 배포 후보 단위는 공개 GitHub Release다. Release 발행은 `release.yml`(`workflow_dispatch`)이 담당하고 사람은 버전 번호만 입력한다. 배포 트리거는 `deploy.yml`이 담당하며, 저장소 변수 `DEPLOY_TRIGGER_ENABLED=true`인 경우에만 Jenkins 내장 원격 빌드 트리거(전용 서비스 사용자 API token Basic 인증)로 **파라미터 없는 POST**를 보낸다. `deploy.yml`은 `release.yml`이 `workflow_call`로 직접 호출하며 단독 `workflow_dispatch`로도 실행할 수 있어 새 Release 발행 없이 배포만 재시도할 수 있다. 트리거 URL은 HTTPS만 허용한다. 배포 서버의 host nginx가 공인 IP TLS를 종료하고 해당 경로의 POST만 localhost Jenkins로 리버스 프록시하며 Jenkins UI는 공개하지 않는다. 나머지 요청은 loopback `127.0.0.1:8081`의 Compose nginx로 전달한다. GitHub Actions는 얇은 트리거 POST만 담당하고 검증·배포·실패 알림은 Jenkins가 수행한다. Jenkins는 트리거로부터 버전을 전달받지 않고 **자체적으로 현재 latest full Release를 조회**해 `draft=false`·`prerelease=false`와 full SemVer tag를 확인한다. tag가 가리키는 정확한 commit SHA가 main 이력에 포함되고 #199 공개 댓글에서 같은 tag·SHA의 @GoBeromsu `RELEASE_ACCEPT role=PM`이 확인될 때만 해당 SHA를 checkout한다. `RELEASE_ACCEPT role=TECH_LEAD`와 `RELEASE_OVERRIDE role=PM`은 폐지한다 — 우회할 이중 게이트가 없으므로 override는 존재 이유가 없다. 별도 staging 서버는 두지 않는다.

Jenkins는 매 실행에서 최신 Release로 수렴하는 멱등 작업이다. 현재 실행 중인 컨테이너의 이미지 태그를 조회해 대상 Release와 같거나 대상이 더 낮으면 성공 no-op 처리한다. 새 Release는 명시적 Prisma client generate → test → PostgreSQL backup → 서버 로컬 frontend/backend 이미지 1회 build → `prisma migrate deploy` → `up -d --no-build --wait` → `/`·`/api/v1/health` smoke 순서로 배포한다. 이미지는 release tag로 태깅하므로 별도 영속 배포 상태 파일을 두지 않으며, 배포 상태의 원본은 실행 중인 컨테이너 자신이다. 서비스 교체 또는 smoke가 실패하면 `PREV_TAG` 이미지로 한 번 rollback한다. 배포 전에는 운영 환경 파일의 `FRONTEND_URL`이 `https://`인지 확인한다. DB restore는 자동화하지 않고 보존한 backup을 사용해 사람이 승인한 수동 복구로 남긴다. `down -v`는 사용하지 않으며 PostgreSQL 데이터는 named volume `pgdata`에, 제출 파일 object data는 named volume `minio_data`에 보존한다.

배포가 성공한 **뒤에만** 이미지와 backup을 정리한다. 실행 중인 이미지와 직전 성공 배포 이미지는 rollback 대상이므로 절대 삭제하지 않고, 그보다 이전 이미지만 제거한다. 개수가 아니라 이 보존 규칙이 판단 기준이다. DB backup은 최근 N개만 유지하며, N은 실측한 dump 크기·증가율·가용 예산·최대 배포 빈도·복구 보존 기간으로 산정해 승인 기록에 남긴다. N이 확정되기 전에는 정리를 수행하지 않는다(fail-closed).

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
- GitHub Release는 production 배포 후보이며, 같은 tag·SHA의 @GoBeromsu `RELEASE_ACCEPT role=PM` 한 건을 유일한 사람 승인 지점으로 사용한다.
- 동일·하위 Release 재전달은 no-op이므로 webhook 재전송이 중복 배포로 이어지지 않는다.

### Costs / trade-offs

- Jenkins와 배포 서버의 webhook, Docker, Compose 운영 책임이 생긴다.
- 로컬 빌드 이미지는 서버 밖에서 재사용되지 않으며, greenfield 실패는 자동 rollback할 수 없다.
- migration 이후의 DB restore는 자동 rollback 범위 밖이므로 backup 확인과 수동 복구 책임자가 필요하다.

### New constraints

- GitHub Actions required job 이름은 반드시 `ci`이고 모든 PR에서 보고되어야 한다.
- 경로별 검증 대상과 synthetic-only 경계는 [CI 경로별 검증 계약](../rules/ci-path-verification.md)을 따른다.
- Jenkins는 production 배포만 담당하고 main 검증은 GitHub Actions `ci`가 단독으로 수행한다. Jenkins는 현재 latest full GitHub Release만 처리한다.
- production 배포 트리거는 GitHub Actions `deploy.yml`이 `DEPLOY_TRIGGER_ENABLED=true`를 확인한 뒤 HTTPS Jenkins 내장 원격 트리거(전용 서비스 사용자 API token)로 파라미터 없이 보낸다. 공개 표면은 `POST /job/oss-hub-release-cd/build` 정확일치 경로 하나뿐이며 host nginx가 그 경로의 POST만 프록시한다. 파라미터 계약을 쓰는 구 경로는 새 경로가 동작을 실증한 뒤 같은 점검 창 안에서 회수한다. 배포 대상 판별은 트리거 입력이 아니라 Jenkins의 latest Release 조회가 담당하며, draft·prerelease·full SemVer가 아닌 tag는 그 조회 결과를 근거로 Jenkins가 거절한다. 트리거 엔드포인트·API token 값은 GitHub repo secret에만 두고 저장소·로그에 남기지 않는다.
- 배포 실패 알림은 Jenkins email-ext 플러그인으로 보내며 수신자·SMTP는 Jenkins UI 설정(Manage Jenkins → System → Extended E-mail Notification의 Default Recipients + SMTP)에만 두고 저장소에 이메일 주소를 남기지 않는다.
- tag commit은 main ancestry를 통과한 exact SHA여야 한다. 태그가 다른 커밋으로 이동하거나 승인 없는 tag가 만들어져도, 승인 검증이 Jenkins가 그 실행에서 해석한 SHA로 `RELEASE_ACCEPT role=PM tag=<tag> head=<sha>` 정확 일치를 요구하므로 fail-closed로 차단된다. 태그 조작 방어의 원본은 이 승인 바인딩이며 영속 상태 파일이 아니다.
- Jenkins는 Docker 권한을 가진 `oss-hub-production` 전용 executor에서만 실행하고 동시 실행을 금지한다. 운영 환경 파일은 Credentials Store의 file credential로 실행 시점에만 주입한다.
- Compose는 `COMPOSE_PROJECT_NAME`을 고정하며 `pgdata`와 기존 데이터를 삭제하는 `down -v`를 사용하지 않는다.
- host nginx만 공인 80/443을 열고 약 6일 유효한 Let's Encrypt IP 인증서를 종료한다. Compose nginx는 `127.0.0.1:8081`에만 bind하여 `/`를 front로, `/api`를 back으로 라우팅하고 `/api/v1` 접두사는 제거하지 않는다. 런타임은 nginx, front, back, postgres와 제출 파일 object storage(`minio` 지속 서비스, `minio-bucket` 초기화 서비스)로 구성된다.
- 제출 파일 object data는 `minio_data` volume에 있으며 **현재 배포 파이프라인의 backup 대상이 아니다**. `pg_dump`는 PostgreSQL만 보호한다. 이 간극이 닫히기 전까지 제출 파일 업로드 경로는 Compose nginx에서 fail-closed로 차단하고, 차단 해제는 off-host object backup과 restore drill을 완료한 뒤 별도 high-risk 변경으로만 수행한다.
- Certbot 5.4 이상의 `shortlived` IP 인증서를 webroot로 자동 갱신하고 성공한 갱신 뒤 host nginx를 reload한다. 인증서 갱신 실패는 만료 전 운영 경보 대상이다.

## Changelog

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
