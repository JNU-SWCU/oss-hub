---
slug: ADR-006-github-app-integration
date: 2026-07-21
author: Lumiere001
status: Accepted
references:
  - Issue-15
  - Issue-36
  - Issue-120
  - Issue-119
  - Issue-121
  - Issue-123
  - Issue-125
  - Issue-205
refines: []
---

# ADR-006: GitHub App 조직 자동화 연동

## Status

Accepted

## Date

2026-07-21

## Context

사용자 로그인은 기존 GitHub OAuth를 유지하지만, 신청 승인 뒤 조직 저장소를 생성하고 collaborator를 초대하며 webhook을 받는 자동화에는 사용자 credential과 분리된 인증 주체가 필요하다.

이 결정은 `Application APPROVED + OutboxEvent PENDING`을 만드는 #119, outbox를 소비해 저장소를 생성·초대하는 #121, `push`·`release` webhook을 기존 수집 파이프라인에 적재하는 #123, 마일스톤 이후 별도 공개 동작을 제공하는 #125의 공통 계약이다.

파일럿 수집 대상은 `JNU-SWCU` Organization의 기존·신규 repository 전체이며 public/private visibility와 무관하다.
조직 전체를 읽는 수집 권한과 platform-managed repository를 생성·초대·공개하는 쓰기 권한을 한 App에 결합하면 전체 조직에 불필요한 `Administration: write` 권한이 생긴다.
따라서 두 역할을 별도 GitHub App과 installation으로 분리한다.

개인 계정 소유 repository는 파일럿 범위가 아니다.
학생이 직접 설치하는 #15의 read-only App은 post-pilot 별도 결정으로 남기며 이 ADR의 credential이나 permission을 재사용하지 않는다.

## Decision

### 인증 주체와 권한 경계

조직 소유 `Collection App`과 `Repository Operations App`을 test와 production에 각각 별도 등록하고 각 환경의 대상 조직에 설치한다.
두 App은 각자의 installation access token만 사용하며 사용자 OAuth token이나 user access token을 사용하지 않는다.

`Collection App`은 조직 전체 repository의 metadata·commit·pull request와 `push`·`release` webhook을 읽지만 repository를 생성하거나 collaborator·visibility를 변경할 수 없다.
`Repository Operations App`은 platform-managed repository의 생성·collaborator 초대·visibility 변경만 수행하고 조직 전체 webhook 수집 권한을 갖지 않는다.
두 App은 App ID, private key, installation token cache를 공유하지 않는다.

test와 production App은 App ID, private key, webhook secret, 설치 대상 조직을 공유하지 않는다.
App 등록과 권한 변경은 대상 조직 owner가 검토·승인하고, 승인되지 않은 새 권한이 필요한 기능은 배포하지 않는다.

### repository 소유권과 사용자 권한

repository의 기술적 owner는 `JNU-SWCU` Organization이다.
개인형 신청자는 본인, 팀형 신청자는 승인 시점의 팀장·팀원이 자기 repository에 `push` collaborator 권한을 받아 기여·사용·접근한다.
이 권한은 코드 저작권·IP가 사업단에 이전되거나 공동 저작권이 성립한다는 뜻이 아니며, 라이선스·성과물 IP 조건은 별도 프로그램 약관으로 다룬다.
같은 팀이 아닌 학생은 private repository와 해당 metric에 접근하지 못한다.
조직 전체 visibility 변경 권한은 승인된 staff/admin 동작으로만 사용할 수 있으며 App credential 자체는 backend secret store 밖으로 배포하지 않는다.

### 설치 범위와 installation 발견

`Collection App`은 `All repositories`로 설치해 `JNU-SWCU` Organization의 기존·신규 repository 전체를 public/private 구분 없이 수집한다.
이 installation에는 read와 webhook 권한만 있으며 write/admin 권한은 없다.

`Repository Operations App`은 `Only select repositories`로 설치한다.
기존 조직 저장소는 플랫폼이 실제로 관리할 저장소만 선택하고, 이 App이 새로 생성한 저장소는 GitHub가 해당 installation의 접근 대상에 자동으로 추가하는 동작을 사용한다.
따라서 관련 없는 조직 저장소 전체에 `Administration: write`를 부여하지 않는다.

서비스는 설정된 조직 login을 사용해 각 App JWT로 `GET /orgs/{org}/installation`을 호출하고 역할별 installation ID와 설치 대상 account를 확인한다.
installation ID는 credential이 아니며 별도 환경변수로 고정하지 않고 발견 결과를 프로세스 메모리에 캐시한다.
응답의 account login이 설정된 조직과 다르면 API 호출을 시작하지 않는다.
`Collection App` installation을 확인할 수 없으면 #123 조직 수집을 중단하고 사용자 OAuth나 PAT로 대체하지 않는다.
`Repository Operations App` installation을 확인할 수 없으면 해당 프로그램의 repository provisioning을 비활성화한다.
#119는 기능이 꺼진 프로그램을 승인하되 outbox를 만들지 않고, 이미 대기 중인 #121 job은 installation 누락 최종 실패로 운영 화면에 남긴다.

필요한 설정 이름은 다음 여섯 가지다.

- `GITHUB_APP_ORG`
- `GITHUB_COLLECTION_APP_ID`
- `GITHUB_COLLECTION_APP_PRIVATE_KEY`
- `GITHUB_COLLECTION_APP_WEBHOOK_SECRET`
- `GITHUB_OPERATIONS_APP_ID`
- `GITHUB_OPERATIONS_APP_PRIVATE_KEY`

실제 값은 배포 환경의 승인된 secret store에만 저장한다.
Obsidian 운영 인벤토리에는 secret store record 이름·회전 담당·참조 위치만 남기고 값을 복제하지 않는다.
ADR, Issue, PR, commit, 로그, Notion에는 실제 값이나 private key 예시를 기록하지 않는다.

### endpoint와 최소 권한

| 역할 | 동작 | GitHub REST endpoint 또는 이벤트 | 필요한 GitHub App permission | 판정 |
| --- | --- | --- | --- | --- |
| Collection App | 조직 repository metadata 조회 | `GET /repos/{owner}/{repo}` | Repository `Metadata: read` | Org 소속과 mapped/unmapped 상태를 판별한다. |
| Collection App | commit 조회 | `GET /repos/{owner}/{repo}/commits` | Repository `Contents: read` | 집계에 필요한 commit을 installation token으로 읽는다. |
| Collection App | pull request 조회 | `GET /repos/{owner}/{repo}/pulls` | Repository `Pull requests: read` | 집계에 필요한 PR을 installation token으로 읽는다. |
| Collection App | `push`·`release` webhook 수신 | GitHub App event subscription | Repository `Contents: read` | 두 이벤트만 명시적으로 구독한다. |
| Repository Operations App | 조직 private repository 생성 | `POST /orgs/{org}/repos` | Repository `Administration: write` | 생성 요청은 `private: true`로 고정한다. |
| Repository Operations App | repository metadata 조회 | `GET /repos/{owner}/{repo}` | Repository `Metadata: read` | external repository ID·이름·visibility를 대조한다. |
| Repository Operations App | collaborator 여부 확인 | `GET /repos/{owner}/{repo}/collaborators/{username}` | Repository `Metadata: read` | `204`는 이미 collaborator인 성공 상태다. |
| Repository Operations App | 대기 invitation 확인 | `GET /repos/{owner}/{repo}/invitations` | Repository `Administration: read` | 같은 login의 열린 초대는 재발송하지 않는다. |
| Repository Operations App | collaborator 초대 | `PUT /repos/{owner}/{repo}/collaborators/{username}` | Repository `Administration: write` | 학생에게 필요한 최소 역할인 `permission: push`를 사용한다. |
| Repository Operations App | private에서 public으로 전환 | `PATCH /repos/{owner}/{repo}` | Repository `Administration: write` | #125의 staff action 뒤 `visibility: public`으로 바꾸고 metadata를 다시 조회한다. |

`Collection App`은 Repository `Metadata: read`, `Contents: read`, `Pull requests: read`만 요청한다.
`Repository Operations App`은 Repository `Administration: write`와 `Metadata: read`만 요청한다.
Organization `Members`를 포함한 organization permission은 어느 App에도 요청하지 않는다.
`Administration: write`가 invitation 조회의 `Administration: read` 요구도 포함한다.

Collection App의 REST read 권한은 조직 저장소의 read-only reconciliation과 집계에 사용하며 #123의 webhook 구독 범위를 확장하지 않는다.
#151은 기존 인증과 수집 로직을 유지하고 #123은 webhook 수신만 구현했으므로, production installation-token REST client가 필요하면 두 티켓에 소급해 섞지 않고 별도 구현 티켓으로 분리한다.

### 승인 시점 collaborator snapshot

#119는 신청 승인과 outbox 생성을 같은 트랜잭션에서 처리할 때 승인 시점의 collaborator login 목록을 계산한다.
개인형은 신청자 login 한 개, 팀형은 승인 시점의 팀장·팀원 login을 사용한다.
login은 대소문자를 구분하지 않는 값으로 정규화하고 정렬·중복 제거한 뒤 outbox JSON의 `collaboratorGithubLogins`에 저장한다.

```json
{
  "applicationId": "application-fixture-id",
  "programId": "program-fixture-id",
  "teamId": null,
  "requestedAt": "2026-01-01T00:00:00Z",
  "collaboratorGithubLogins": ["fixture-student"]
}
```

#121은 worker 실행 시점의 현재 팀 구성을 다시 계산하지 않고 이 snapshot을 소비한다.
이 변경은 기존 `OutboxEvent.payload Json`을 사용하므로 schema나 migration을 추가하지 않는다.

이미 collaborator이면 invitation을 성공으로 기록한다.
같은 login의 열린 invitation이 있으면 새 invitation을 보내지 않고 `PENDING`으로 수렴한다.
새 invitation의 `201` 응답도 발송 성공이므로 `PENDING`으로 기록하고, 조직 구성원 등 즉시 접근이 부여된 `204` 응답은 `SUCCEEDED`로 기록한다.

존재하지 않는 login과 조직 policy로 차단된 outside collaborator는 최종 실패다.
GitHub가 명시한 repository별 24시간 invitation 한도는 재시도 가능 실패로 분류하며, 같은 저장소를 다시 만들지 않고 실패한 invitation만 다음 24시간 창 이후 재시도한다.

### JWT와 installation token

각 App은 자기 App ID와 private key로 `RS256` JWT를 생성한다.
clock skew를 고려해 `iat`은 현재 시각보다 60초 이전으로 두고 `exp`는 생성 시각에서 최대 10분 이내로 둔다.
JWT는 `POST /app/installations/{installation_id}/access_tokens` 호출에만 사용하고 저장하지 않는다.

installation access token은 GitHub가 반환한 `expires_at`까지만 프로세스 메모리에 캐시한다.
각 프로세스는 App 역할과 installation ID별로 만료 5분 전부터 단일 갱신 promise를 공유해 동시 재발급을 막는다.
공유 cache나 신규 인프라는 도입하지 않는다.
API가 `401`을 반환하면 기존 token을 폐기하고 한 번만 재발급한 뒤 요청을 재시도한다.

token, JWT, private key, `Authorization` header, webhook signature, 전체 요청·응답 header는 로그나 DB에 저장하지 않는다.
rate limit 대응에 필요한 `retry-after`, `x-ratelimit-remaining`, `x-ratelimit-reset`의 검증된 숫자 값만 구조화 로그에 남길 수 있다.

### 오류와 재시도

오류 분류는 #121의 durable job 상태와 맞춘다.

| 조건 | 분류 | 처리 |
| --- | --- | --- |
| network timeout·연결 실패 | `FAILED_RETRYABLE` | 설정된 backoff 뒤 같은 단계부터 재시도한다. |
| `429` 또는 rate-limit으로 판정된 `403` | `FAILED_RETRYABLE` | `Retry-After`, reset 시각, 최소 1분 지연 순으로 다음 실행 시각을 정한다. |
| GitHub `5xx` | `FAILED_RETRYABLE` | 설정된 backoff 뒤 재시도한다. |
| `401` | token 1회 갱신 후 재판정 | 갱신 후에도 `401`이면 `FAILED_FINAL` authentication 오류다. |
| rate-limit이 아닌 `403` | `FAILED_FINAL` | App 권한·조직 policy·installation 상태를 확인한다. |
| installation 조회 `404` | `FAILED_FINAL` | 설치 누락 또는 잘못된 대상 조직으로 기록한다. |
| repository 생성 전 metadata 조회 `404` | 정상 분기 | 저장소 미존재로 보고 생성 단계로 진행한다. |
| invalid login·입력 검증 `422` | `FAILED_FINAL` | 민감하지 않은 오류 코드만 저장한다. |
| invitation 한도로 확인된 응답 | `FAILED_RETRYABLE` | 다음 24시간 창 이후 실패 invitation만 재시도한다. |

재시도 한도를 소진하면 `FAILED_FINAL`로 전이한다.
로그에는 event ID, job ID, application ID, attempt, 정규화한 error code만 남긴다.

### webhook 보안과 데이터 최소화

#123은 사용자 세션 인증 대신 `GITHUB_COLLECTION_APP_WEBHOOK_SECRET`으로 raw request body의 `X-Hub-Signature-256` HMAC-SHA256 서명을 검증한다.
서명은 constant-time 비교를 사용하고 검증이 끝나기 전에 JSON을 파싱하거나 데이터를 쓰지 않는다.

`X-GitHub-Delivery`는 durable idempotency key이며 `CollectionRun.id`는 `webhook:{deliveryId}` 형태로 결정한다.
같은 delivery의 재전송은 기존 run을 확인하고 observation이나 집계를 늘리지 않은 채 성공 응답한다.

명시 구독 이벤트는 `push`와 `release`뿐이다.
모든 GitHub App에 기본 제공되는 `installation`과 `installation_repositories` 이벤트도 검증하며, installation 삭제·정지 시 Collection App token cache를 폐기하고 조직 수집을 중단한다.

#123은 `JNU-SWCU` Organization에서 온 기존·신규 repository 이벤트를 public/private와 무관하게 수집한다.
platform-managed repository는 `Repository` 매핑을 사용해 program·application·team 범위에 연결한다.
매핑되지 않은 Org repository도 무시하지 않고 Org-wide 관측으로 처리하되 존재하지 않는 program이나 team 매핑을 만들지 않는다.
#123은 구현 전에 mapped와 unmapped repository를 함께 표현하는 저장·집계 계약을 잠그며, 이 ADR은 schema 변경 자체를 승인하지 않는다.
private repository의 metric은 승인된 staff와 해당 팀에만 노출하고 같은 팀이 아닌 학생에게 노출하지 않는다.
visibility가 바뀌어도 기존 관측과 집계를 삭제하거나 초기화하지 않는다.

webhook raw body와 전체 header는 영구 저장하지 않는다.
검증 후 기존 `GithubRawObservation.payload`에는 delivery ID, event·action, repository numeric ID·full name, 발생 시각, commit SHA·개수 또는 release ID·tag처럼 집계와 멱등 처리에 필요한 allowlist 필드만 저장한다.
commit author email·message, release body, token, signature, secret, 불필요한 사용자 profile은 저장하지 않는다.

### live smoke 계약

자동 테스트는 GitHub API mock과 합성 fixture만 사용해 성공·rate limit·permission 오류·중복 요청·서명 valid/invalid를 검증할 수 있다.
live smoke는 승인된 test org와 역할별 test App이 준비된 뒤에만 수행한다.

Repository Operations App smoke는 다음 순서로 수행한다.

1. 합성 이름의 private repository 한 개를 생성하고 `201`과 external repository ID를 기록한다.
2. 같은 application fixture를 반복 처리해 repository가 한 개뿐인지 확인한다.
3. 합성 test collaborator 한 명을 초대하고 invitation 조회 뒤 같은 요청을 반복해 초대가 늘지 않는지 확인한다.
4. repository metadata를 조회하고 public으로 전환한 뒤 visibility를 다시 확인한다.
5. 테스트 repository를 정리하고 조회 `404`로 삭제를 확인한다.

이 smoke의 PASS와 공개-safe 증거 첨부를 PR #204의 Draft 해제 조건으로 사용한다.

Collection App의 REST read 권한 smoke는 commit 한 개와 PR 한 개가 준비된 별도 private 합성 repository에서 수행한다.
실제 installation token으로 metadata·commit·PR 조회가 각각 `200`인지 확인하며, 이는 `Metadata: read`, `Contents: read`, `Pull requests: read` 권한만 증명한다.

#123 webhook 보안 smoke는 실제 `push` 또는 `release` delivery 한 건의 valid signature 처리, 같은 delivery ID 재전송의 멱등 처리, 합성 invalid signature 거절을 확인한다.
REST read 권한 smoke는 webhook event subscription·HMAC 검증·delivery 멱등 처리를 대체하지 않으며 webhook smoke도 REST read 권한을 증명하지 않는다.

공개 증거에는 endpoint, status code, 합성 fixture 이름, UTC 시각, 결과만 남긴다.
token, secret, header, private key, 실제 사용자 데이터는 증거에 포함하지 않는다.

현재 live smoke는 승인된 비운영 org, 역할별 test App, org owner의 설치·권한 승인 경로, 공개 HTTPS webhook endpoint, 합성 collaborator, secret store 주입이 준비되지 않아 대기 상태다.
PM 결정으로 ADR은 `Accepted`이지만 이 상태 변경이 실제 App 설치나 #121·#123 구현 검증을 완료했다는 뜻은 아니다.
비운영 경로가 지정되기 전까지 두 App 연동은 fail-closed이며 live smoke는 구현 검증 blocker로 남는다.

## Alternatives considered

### 사용자 OAuth token 권한 확장

- Pros: 기존 로그인 흐름을 재사용할 수 있다.
- Cons: 조직 자동화가 특정 사용자 로그인·동의·token 수명에 의존하고 로그인 credential과 write 자동화 경계가 합쳐진다.
- **Rejected:** 학생 사용자 token으로 write API를 호출하지 않는 저장소 보안 규칙과 맞지 않는다.

### fine-grained PAT와 서비스 계정

- Pros: 초기 호출 구현은 단순하다.
- Cons: 개인 또는 서비스 계정에 장기 credential과 수동 회전이 결합되고 installation 회수·repository 선택·App webhook 통합을 제공하지 못한다.
- **Rejected:** 조직 소유권, 짧은 수명 token, 최소 repository 권한, webhook 수명주기를 하나로 관리하는 GitHub App보다 운영 의존성이 크다.

### 하나의 `All repositories` App에 read와 write 결합

- Pros: App 등록·installation·credential 운영 수가 적다.
- Cons: 조직 전체 수집을 위해 필요한 범위보다 넓게 모든 repository에 `Administration: write`가 적용된다.
- **Rejected:** read credential 침해가 곧 조직 전체 repository의 생성·초대·visibility 변경 권한 침해가 되므로 최소 권한 경계를 충족하지 못한다.

### 하나의 App과 installation token 권한 축소

- Pros: 호출별 token에 repository와 permission 하위 집합을 요청해 정상 경로의 권한을 줄일 수 있다.
- Cons: App 등록 자체는 조직 전체 admin 권한을 보유하고 private key를 가진 주체가 더 넓은 token을 발급할 수 있어 credential 경계가 분리되지 않는다.
- **Rejected:** 실수와 credential 침해의 blast radius를 App 수준에서 제한하지 못한다.

### 두 App 모두 `Only select repositories`

- Pros: 모든 App의 repository 범위를 플랫폼 관리 대상으로 제한한다.
- Cons: Collection App이 기존·신규 Org repository 전체를 자동으로 수집해야 한다는 파일럿 계약을 충족하지 못한다.
- **Rejected:** `Only select repositories`는 쓰기 App에만 적용하고 read-only Collection App은 `All repositories`로 설치한다.

## Consequences

### Enables

- #121은 Repository Operations App의 installation token client와 durable worker를 구현할 수 있다.
- #123은 read-only Collection App의 webhook secret과 최소 이벤트 목록으로 Org 전체 실시간 수집을 구현할 수 있다.
- Collection App installation token은 조직 repository의 metadata·commit·pull request를 읽을 수 있고 쓰기 권한은 갖지 않는다.
- #123은 platform-managed repository를 기존 `Repository` 관계에 매핑하고 unmapped Org repository는 가짜 program·team 관계 없이 처리한다.
- #125는 모든 필수 마일스톤 승인 뒤 별도 staff/admin action으로만 Repository Operations App의 공개 전환을 호출한다.
- 승인 시점 collaborator snapshot이 팀 변경과 worker 지연 사이의 의미 변화를 막는다.
- 조직 전체 read/webhook 권한과 platform-managed repository write/admin 권한의 credential과 installation을 분리한다.

### Costs / trade-offs

- test와 production에서 역할별 App 등록·private key·webhook secret을 따로 운영하고 각각 org owner 승인을 받아야 한다.
- Repository Operations App은 `Only select repositories`이므로 기존 platform-managed 저장소를 최초 설치 때 명시적으로 선택해야 한다.
- Collection App은 `All repositories` 설치이므로 새 Org repository가 수집 범위에 자동 포함된다.
- installation 회수·permission 변경과 token 만료를 운영 상태로 관찰해야 한다.
- live smoke가 완료될 때까지 #121·#123의 실제 GitHub 연동 완료를 주장할 수 없다.

### New constraints

- #119 outbox payload는 `collaboratorGithubLogins` 승인 snapshot을 포함해야 한다.
- #121은 현재 Team 관계가 아니라 outbox snapshot을 초대 대상의 원본으로 사용한다.
- #121은 Repository Operations App만 사용하고 #123은 Collection App만 사용한다.
- #121과 #123은 실제 credential·header·raw webhook body를 로그나 DB에 남기지 않는다.
- #123의 unmapped Org repository 처리는 program·team 가짜 매핑을 만들지 않는다.
- 공개 전환은 review 승인과 분리된 #125 staff/admin action이며 자동화하거나 학생에게 Org-wide visibility write 권한을 주지 않는다.
- 학생용 read-only 수집 App #15는 post-pilot이며 두 조직 App의 permission을 재사용하지 않는다.

## References

- [Issue #120: GitHub App 연동 스파이크/ADR](https://github.com/JNU-SWCU/oss-hub/issues/120)
- [Issue #15: 학생 설치용 read-only App](https://github.com/JNU-SWCU/oss-hub/issues/15)
- [Issue #36: Org 저장소 수집·가시성 경계](https://github.com/JNU-SWCU/oss-hub/issues/36)
- [Issue #119: 신청 승인과 durable outbox](https://github.com/JNU-SWCU/oss-hub/issues/119)
- [Issue #121: 저장소 provision worker](https://github.com/JNU-SWCU/oss-hub/issues/121)
- [Issue #123: webhook 실시간 수집](https://github.com/JNU-SWCU/oss-hub/issues/123)
- [Issue #125: staff 검토와 별도 공개 전환](https://github.com/JNU-SWCU/oss-hub/issues/125)
- [Issue #205: GitHub App live smoke 승인](https://github.com/JNU-SWCU/oss-hub/issues/205)
- [GitHub REST repositories endpoints](https://docs.github.com/en/rest/repos/repos)
- [GitHub REST commits endpoints](https://docs.github.com/en/rest/commits/commits)
- [GitHub REST pull requests endpoints](https://docs.github.com/en/rest/pulls/pulls)
- [GitHub REST collaborators endpoints](https://docs.github.com/en/rest/collaborators/collaborators)
- [GitHub REST repository invitation endpoints](https://docs.github.com/en/rest/collaborators/invitations)
- [GitHub App authentication](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/about-authentication-with-a-github-app)
- [Generating a GitHub App JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Installing a GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
- [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [GitHub REST API rate-limit troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)

## Changelog

- 2026-07-21: Issue #120에 따라 조직 자동화 App의 인증·최소 권한·token·webhook·후속 티켓 계약을 Proposed로 기록했다.
- 2026-07-21: Issue #36과 #120의 PM 결정에 따라 Org-wide read Collection App과 selected-repository write Operations App을 분리하고 파일럿 수집·소유권·공개 경계를 Accepted로 확정했다.
- 2026-07-22: Issue #205의 조건부 승인에 따라 Collection App의 `Pull requests: read`를 추가하고 installation-token REST read smoke, Repository Operations App Ready gate, #123 webhook 보안 smoke를 분리했다.
