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

## Date

2026-07-11

## Context

PR 품질 검증은 필요하지만 CI에서 Docker 이미지를 빌드하면 실행 시간과 과금이 늘어난다. 또한 브랜치 보호의 required check는 PR마다 항상 보고되어야 하며, 경로 조건으로 job 자체가 생략되면 병합 대기 상태가 교착될 수 있다. 배포 서버에는 레지스트리 없이 Docker를 실행하며, 실패 시 직전 배포로 복구할 수 있어야 한다. 초기 배포에는 직전 이미지가 없는 greenfield 상태도 존재한다.

## Decision

GitHub Actions는 모든 PR에서 실행되는 경량 CI로 구성하고 required job 이름을 항상 `ci`로 유지한다. `ci` job 내부에서 paths gate를 처리하여 대상 변경이 없더라도 job 결과를 보고한다. CI는 lint, typecheck, test, 앱 build를 수행하고 Docker 이미지 빌드는 수행하지 않는다. 병합 검토는 ADR-005의 exact-head `MERGE_READY`와 high-risk 이중 accept 계약을 따른다.

main 병합은 Jenkins의 lint, typecheck, test, 앱 build 검증만 시작하고 production 배포를 시작하지 않는다. production 배포 후보 단위는 공개 GitHub Release다. Jenkins는 서명이 검증된 `created` 또는 `published` release webhook에서 `vMAJOR.MINOR.PATCH` tag를 받아 `draft=false`, `prerelease=false`, 현재 latest full Release 일치를 확인한다. tag가 가리키는 정확한 commit SHA가 main 이력에 포함되고 ADR-005의 PM·Tech Lead `RELEASE_ACCEPT`가 같은 tag와 SHA에 모두 있을 때만 해당 SHA를 checkout한다. 이 검증 단계가 구현되기 전에는 production Release webhook job을 활성화하지 않는다. 별도 staging 서버는 두지 않는다.

이미 성공한 Release와 같거나 낮은 버전은 영속 배포 상태를 기준으로 성공 no-op 처리한다. 새 Release는 test → PostgreSQL backup → 서버 로컬 frontend/backend 이미지 1회 build → `prisma migrate deploy` → `up -d --no-build --wait` → `/`·`/api/v1/health` smoke 순서로 배포하고, 모두 성공한 뒤에만 정상 Release와 SHA를 기록한다. 서비스 교체 또는 smoke가 실패하면 `PREV_TAG` 이미지로 한 번 rollback한다. DB restore는 자동화하지 않고 보존한 backup을 사용해 사람이 승인한 수동 복구로 남긴다. `down -v`는 사용하지 않으며 PostgreSQL 데이터는 named volume `pgdata`에 보존한다.

## Alternatives considered

### CI에서 Docker 이미지 빌드

- Pros: 컨테이너 빌드 정의를 PR 단계에서 검증할 수 있다.
- Cons: CI 실행 시간과 과금이 증가하고, 애플리케이션 품질 검증과 중복되는 작업이 많다.
- **Rejected:** lint, typecheck, test, 앱 build로 필요한 빠른 피드백을 제공하고 이미지 빌드는 배포 서버에서 한 번만 수행한다.

### 레지스트리 기반 배포

- Pros: 이미지 이동과 배포 이력 관리가 표준화된다.
- Cons: 레지스트리 운영·권한·전송 비용과 추가 설정이 필요하다.
- **Rejected:** 단일 배포 서버에서는 커밋 SHA 기반 서버 로컬 빌드가 더 단순하고 비용을 줄인다.

## Consequences

### Enables

- 모든 PR에서 `ci` required check가 보고되어 브랜치 보호 교착을 피한다.
- Docker 이미지 빌드 과금을 CI에서 제거하고 배포당 한 번으로 제한한다.
- SHA 태그와 `PREV_TAG`로 배포 및 rollback 대상을 명확히 식별한다.
- GitHub Release 발행을 production 사람 승인 지점으로 사용하고 main 검증과 운영 배포를 분리한다.
- 동일·하위 Release 재전달은 no-op이므로 webhook 재전송이 중복 배포로 이어지지 않는다.

### Costs / trade-offs

- Jenkins와 배포 서버의 webhook, Docker, Compose 운영 책임이 생긴다.
- 로컬 빌드 이미지는 서버 밖에서 재사용되지 않으며, greenfield 실패는 자동 rollback할 수 없다.
- migration 이후의 DB restore는 자동 rollback 범위 밖이므로 backup 확인과 수동 복구 책임자가 필요하다.

### New constraints

- GitHub Actions required job 이름은 반드시 `ci`이고 모든 PR에서 보고되어야 한다.
- 경로별 검증 대상과 synthetic-only 경계는 [CI 경로별 검증 계약](../rules/ci-path-verification.md)을 따른다.
- Jenkins는 main에서 검증만 수행하고 production은 현재 latest full GitHub Release만 처리한다.
- release webhook은 HMAC을 검증하고 `created`·`published` 외 action과 full SemVer가 아닌 tag를 거절한다.
- tag commit은 main ancestry를 통과한 exact SHA여야 하며, 성공 상태 기록 전까지 동일·하위 버전 no-op 기준을 바꾸지 않는다.
- Jenkins는 Docker 권한을 가진 `oss-hub-production` 전용 executor에서만 실행하고 동시 실행을 금지한다. 운영 환경 파일은 Credentials Store의 file credential로 실행 시점에만 주입한다.
- Compose는 `COMPOSE_PROJECT_NAME`을 고정하며 `pgdata`와 기존 데이터를 삭제하는 `down -v`를 사용하지 않는다.
- nginx(80/443)는 `/`를 front로, `/api`를 back으로 라우팅하고 `/api/v1` 접두사는 제거하지 않는다. 런타임은 nginx, front, back, postgres 네 컨테이너다.

## Changelog

- 2026-07-22: production 승인 단위를 GitHub Release로 전환하고 main 검증 전용·exact SHA·no-op·backup·수동 DB 복구 계약 추가 (#199)
- 2026-07-16: 경로별 검증 계약 링크 추가
- 2026-07-11: initial decision

## References

- [GitHub Actions](https://docs.github.com/actions)
- [Jenkins Pipeline](https://www.jenkins.io/doc/book/pipeline/)
- [Docker Compose](https://docs.docker.com/compose/)
