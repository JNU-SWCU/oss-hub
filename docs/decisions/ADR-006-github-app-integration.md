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

사용자 로그인은 기존 GitHub OAuth를 유지하지만, 신청 승인 뒤 조직 저장소를 생성하고 collaborator를 초대하는 자동화와 조직 전체 current-state 수집에는 사용자 credential과 분리된 인증 주체가 필요하다.
이 결정은 `Application APPROVED + OutboxEvent PENDING`을 만드는 #119, outbox를 소비해 저장소를 생성·초대하는 #121, REST로 조직 전체 current state를 생성하는 수집 경로, 마일스톤 이후 별도 공개 동작을 제공하는 #125의 공통 계약이다.

파일럿 수집 대상은 `JNU-SWCU` Organization의 기존·신규 repository 전체이며 public/private visibility와 무관하다.
조직 전체를 읽는 수집 권한과 platform-managed repository를 생성·초대·공개하는 쓰기 권한을 한 App에 결합하면 전체 조직에 불필요한 `Administration: write` 권한이 생긴다.
따라서 두 역할을 별도 GitHub App과 installation으로 분리한다.

개인 계정 소유 repository는 파일럿 범위가 아니다.
학생이 직접 설치하는 #15의 read-only App은 post-pilot 별도 결정으로 남기며 이 ADR의 credential이나 permission을 재사용하지 않는다.

## Decision

### 인증 주체와 권한 경계

조직 소유 `Collection App`과 `Repository Operations App`을 test와 production에 각각 별도 등록하고 각 환경의 대상 조직에 설치한다.
두 App은 각자의 installation access token만 사용하며 사용자 OAuth token이나 user access token을 사용하지 않는다.

`Collection App`은 REST로 조직 전체 repository의 metadata·default-branch commit·all-state pull request·published release만 읽으며 repository를 생성하거나 collaborator·visibility를 변경할 수 없다.
`Repository Operations App`은 platform-managed repository의 생성·collaborator 초대·visibility 변경만 수행하고 조직 전체 수집 권한을 갖지 않는다.
두 App은 App ID, private key, installation token cache를 공유하지 않는다.

test와 production App은 App ID, private key, installation token cache, 설치 대상 조직을 공유하지 않는다.
App 등록과 권한 변경은 대상 조직 owner가 검토·승인하고, 승인되지 않은 새 권한이 필요한 기능은 배포하지 않는다.

### repository 소유권과 사용자 권한

repository의 기술적 owner는 `JNU-SWCU` Organization이다.
개인형 신청자는 본인, 팀형 신청자는 승인 시점의 팀장·팀원이 자기 repository에 `push` collaborator 권한을 받아 기여·사용·접근한다.
이 권한은 코드 저작권·IP가 사업단에 이전되거나 공동 저작권이 성립한다는 뜻이 아니며, 라이선스·성과물 IP 조건은 별도 프로그램 약관으로 다룬다.
같은 팀이 아닌 학생은 private repository와 해당 metric에 접근하지 못한다.
조직 전체 visibility 변경 권한은 승인된 staff/admin 동작으로만 사용할 수 있으며 App credential 자체는 backend secret store 밖으로 배포하지 않는다.

### 설치 범위와 installation 발견

`Collection App`은 `All repositories`로 설치해 `JNU-SWCU` Organization의 기존·신규 repository 전체를 public/private 구분 없이 수집한다.
이 installation에는 read 권한만 있으며 write/admin 권한은 없고 webhook URL, event subscription, webhook secret을 설정하지 않는다.

`Repository Operations App`은 `Only select repositories`로 설치한다.
기존 조직 저장소는 플랫폼이 실제로 관리할 저장소만 선택하고, 이 App이 새로 생성한 저장소는 GitHub가 해당 installation의 접근 대상에 자동으로 추가하는 동작을 사용한다.
따라서 관련 없는 조직 저장소 전체에 `Administration: write`를 부여하지 않는다.

서비스는 설정된 조직 login을 사용해 각 App JWT로 `GET /orgs/{org}/installation`을 호출하고 역할별 installation ID와 설치 대상 account를 확인한다.
installation ID는 credential이 아니며 별도 환경변수로 고정하지 않고 발견 결과를 프로세스 메모리에 캐시한다.
응답의 account login이 설정된 조직과 다르면 API 호출을 시작하지 않는다.
`Collection App` installation을 확인할 수 없으면 조직 수집을 중단하고 사용자 OAuth token, user access token, PAT로 대체하지 않는다.
`Repository Operations App` installation을 확인할 수 없으면 해당 프로그램의 repository provisioning을 비활성화한다.
#119는 기능이 꺼진 프로그램을 승인하되 outbox를 만들지 않고, 이미 대기 중인 #121 job은 installation 누락 최종 실패로 운영 화면에 남긴다.

필요한 설정 이름은 다음 다섯 가지다.

- `GITHUB_APP_ORG`
- `GITHUB_COLLECTION_APP_ID`
- `GITHUB_COLLECTION_APP_PRIVATE_KEY`
- `GITHUB_OPERATIONS_APP_ID`
- `GITHUB_OPERATIONS_APP_PRIVATE_KEY`

실제 값은 배포 환경의 승인된 secret store에만 저장한다.
Obsidian 운영 인벤토리에는 secret store record 이름·회전 담당·참조 위치만 남기고 값을 복제하지 않는다.
ADR, Issue, PR, commit, 로그, Notion에는 실제 값이나 private key 예시를 기록하지 않는다.

### endpoint와 최소 권한

| 역할 | 동작 | GitHub REST endpoint 또는 이벤트 | 필요한 GitHub App permission | 판정 |
| --- | --- | --- | --- | --- |
| Collection App | installation repository 목록 조회 | `GET /installation/repositories` | Repository `Metadata: read` | `All repositories` 범위의 Org-wide 목록을 pagination한다. |
| Collection App | 조직 repository metadata 조회 | `GET /repos/{owner}/{repo}` | Repository `Metadata: read` | Org 소속과 mapped/unmapped 상태를 판별한다. |
| Collection App | commit 조회 | `GET /repos/{owner}/{repo}/commits` | Repository `Contents: read` | 신규 repo는 default branch 전체를 backfill하고, 기존 repo는 default-branch head probe 이후 알려진 SHA를 만날 때까지만 순회한다. |
| Collection App | pull request 조회 | `GET /repos/{owner}/{repo}/pulls` | Repository `Pull requests: read` | `state=all&sort=created&direction=desc` 고정과 `(createdAt, githubPullRequestId)` tie frontier로 새 PR만 읽는다. |
| Collection App | published release 조회 | `GET /repos/{owner}/{repo}/releases` | Repository `Contents: read` | published release만 포함하며 draft는 제외한다. probe가 바뀐 repo만 published release 목록 전체를 다시 읽어 ID로 dedupe한다. |
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

Collection App의 유일한 수집 authority는 installation token을 사용하는 GitHub REST API이며 webhook, OAuth, PAT 경로를 병행하거나 fallback으로 사용하지 않는다.
API 요청은 `X-GitHub-Api-Version: 2022-11-28`을 고정한다.

### 조직 전체 누적·증분 수집 (canonical contract)

Collection App 설치 범위에 있는 `JNU-SWCU` 조직의 모든 repository를 **visibility와 무관하게** 내부 추적 대상으로 삼는다.
mapped/unmapped, private/public 모두 이 collection 범위에 포함하며 private/public은 **수집 허용 여부가 아니라 외부 응답 field/row 노출 허용 여부**만 결정한다.
조직 밖 repository와 개인 계정 소유 repository는 이 범위 밖이다.

지표는 GitHub의 현재 reachability/state를 재현하는 값이 아니라 **한 번 관측된 고유 활동의 누적값**이다.

```text
commit  unique key  = (repositoryId, sha)
PR      unique key  = (repositoryId, githubPullRequestId)
release unique key  = (repositoryId, githubReleaseId)
```

force-push, PR state 변경, release 삭제는 이미 관측된 unique count를 감소시키지 않는다.
같은 사실의 재관측·재시도·중복 응답도 unique key 때문에 count를 증가시키지 않는다.
이 누적 계약 때문에 tombstone·reachability 재계산과 periodic org-wide full-history reconciliation을 두지 않는다.

신규 repository는 commit·PR·release 세 stream을 1회 full backfill한다.
기존 repository는 hourly run마다 installation 전체를 inventory하되, 각 stream은 endpoint별 safe frontier 이후의 변경분만 처리한다.

- commit: default-branch head probe가 이전과 다르면 최신→과거 순회로 이미 알려진 SHA를 만날 때까지 읽는다. 교집합 SHA가 없는 **연결이 끊긴 repository만** 그 repository의 현재 default branch 전체를 다시 읽어 SHA로 dedupe한 뒤에 frontier를 승격한다.
- pull request: `state=all&sort=created&direction=desc`로 고정 조회하고 `(createdAt, githubPullRequestId)` tie frontier를 넘을 때까지만 읽는다.
- release: 고정된 probe representation(최신 published release ID/시각)이 바뀐 **repository만** published release 목록 전체를 다시 읽어 `(repositoryId, githubReleaseId)`로 dedupe한다. draft release는 계속 제외한다.

위 완전 재스캔은 변경이 감지된 해당 repository에만 적용하는 예외적 복구 scan이며, 변경 없는 repository 전체를 반복 재수집하는 periodic org-wide reconciliation이 아니다.

각 요청은 endpoint·ref/branch·정렬·query·page size·`Accept`·`X-GitHub-Api-Version`을 포함한 **exact request fingerprint**로 식별한다.
이 fingerprint에 대해 nullable `ETag`를 조건부 GET(`If-None-Match`)에 사용해 `304`를 받으면 해당 repository의 해당 stream을 스킵한다.
ETag는 다른 fingerprint 사이에서 재사용하지 않으며, ETag 부재나 실패는 correctness의 전제조건이 아니다 — 항상 안전한 fallback은 위 SHA/tie/ID dedupe 순회다.

provider 요청은 하나의 fair serial queue를 통과하며 최소 250ms 간격으로 페이싱한다.
남은 rate limit이 `max(100, limit의 20%)` 이하로 떨어지면 그 run은 안전하게 정지하고 다음 run의 durable continuation cursor(오래된 순 repository ID)에서 이어간다.
같은 run이 매번 repository 1번부터 다시 시작하지 않는다.

각 endpoint는 최대 100 page로 제한한다.
page 한도, rate limit, 권한 오류, 부분 실패가 발생한 stream은 그 stream의 checkpoint와 aggregate를 승격하지 않고 직전 성공 상태를 유지한다.
재시도는 실패한 stream의 checkpoint부터 이어가며 부분 결과를 확정 상태에 합치지 않는다.
REST 응답은 repository·commit·pull request·release numeric ID, 발생 시각, dedupe key와 합의된 파생 count로 즉시 projection한 뒤 폐기한다.

### 저장·폐기 field inventory

내부 저장(DB)은 collection 범위 판별과 누적 집계에 필요한 아래 field에 한정한다.

- repository: `githubRepositoryId`, 조직 내 repository 이름, **visibility(private/public)**, default branch, mapped/unmapped 상태.
- commit fact: `(repositoryId, sha)`, 발생 시각. commit message·author email·diff·code 내용은 저장하지 않는다.
- PR fact: `(repositoryId, githubPullRequestId)`, 관측 시각. title·body는 저장하지 않는다.
- release fact: `(repositoryId, githubReleaseId)`, 발생 시각. body는 저장하지 않는다.
- 집계: repository/contributor 단위 commit·PR·release 누적 count, 마지막 관측 시각(watermark/frontier), stream 상태.

raw response, code·diff, commit message·author email, pull request title·body, release body, 사용자 profile, credential(JWT/private key/installation token)은 DB·cache·로그·공개 smoke artifact 어디에도 남기지 않는다.
repository의 `githubRepositoryId`·이름·visibility는 내부 collection DB에는 저장하지만, **공개 API 응답과 공개 smoke artifact에는** private repository의 식별 정보(이름, 존재 여부, visibility)를 노출하지 않는다 — "private repository 식별 정보를 남기지 않는다"는 이전 서술은 내부 저장과 공개 노출을 구분하지 않아 실제 구현과 충돌했으므로 위와 같이 층을 분리해 교정한다.

### 공개 노출과 complete/partial inventory

공개 API는 platform publication 조건과 **최신 complete Collection inventory 관측**을 함께 통과해야 노출한다.
`publishedAt` 이후 시점에 관측된 private/missing 상태는 즉시 공개를 차단(fail-closed)한다.
publication 이전의 오래된 private 관측은 방금 완료된 managed publication을 막지 않는다.
partial inventory(page/시간/rate limit/권한 오류로 일부만 관측)는 missing 판정의 증거로 쓰지 않는다 — activity stream 실패와 visibility/presence 안전 관측은 별도 fenced transaction으로 분리한다.

후속 REST client 테스트는 endpoint별 safe frontier와 예외적 complete scan, exact-request ETag의 nullable 특성과 fingerprint 비공유, 100-page 한도, 허용 필드 저장·금지 필드 미저장, 부분 실패 시 checkpoint 미승격, complete/partial inventory에 따른 공개 노출 revocation까지 검증해야 한다.

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

token, JWT, private key, `Authorization` header, 전체 요청·응답 header는 로그나 DB에 저장하지 않는다.
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

### Collection current-state 데이터 최소화

Collection App은 mapped와 unmapped repository를 모두 같은 조직 전체 incremental collection 범위에 포함하되 존재하지 않는 program이나 team 매핑을 만들지 않는다.
private repository의 metric은 승인된 staff와 해당 팀에만 노출하고 같은 팀이 아닌 학생에게 노출하지 않는다.
visibility가 바뀌어도 이미 누적된 관측 facts와 aggregate 이력을 삭제하거나 초기화하지 않는다.
공개 surface와 공개 증거에는 합성 식별자와 집계 결과만 허용하며 실제 organization login, repository full name, 사용자 데이터, private 여부를 추론할 수 있는 값은 포함하지 않는다.

### 누적 저장소로의 1회 전환과 이전 세대 보존

기존 hourly org-wide full-history generation 저장소에서 위 누적·증분 facts/aggregate 저장소로 전환할 때 장기 dual-run을 두지 않는다.

1. 새 저장소에 additive schema로 facts/aggregate/checkpoint 모델을 추가한다.
2. 마지막으로 성공한 기존 generation을 새 facts/aggregate에 1회 backfill한다. 이 backfill은 새 ETag/frontier를 만들어내지 않으며, 가져온 stream은 provider 재순회로 안전한 frontier를 확인하기 전까지 `VERIFYING` 상태로 둔다.
3. synthetic parity 검증(기존 집계 = backfill 결과)과 재시도 idempotency를 통과한 뒤, 하나의 release/config 경계에서 old writer를 끄고 새 reader/writer로 원자 전환한다.
4. old generation 테이블은 전환 이후 한 release 동안 read-only rollback 용도로 보존한다. rollback은 이 테이블이 제공하는 마지막 성공 generation을 current로 복원하는 것으로 한정한다.
5. 보존 기간이 끝나면 old generation 테이블 제거는 별도로 추적하는 후속 migration에서 수행하며 이 ADR의 전환 자체에 포함하지 않는다.

### live smoke 계약

자동 테스트는 GitHub API mock과 합성 fixture만 사용해 성공·rate limit·permission 오류·중복 요청과 부분 실패로 인한 stream 미승격을 검증할 수 있다.
live smoke는 승인된 test org와 역할별 test App이 준비된 뒤에만 수행한다.

Repository Operations App smoke는 다음 순서로 수행한다.

1. 합성 이름의 private repository 한 개를 생성하고 `201`과 external repository ID를 기록한다.
2. 같은 application fixture를 반복 처리해 repository가 한 개뿐인지 확인한다.
3. 합성 test collaborator 한 명을 초대하고 invitation 조회 뒤 같은 요청을 반복해 초대가 늘지 않는지 확인한다.
4. repository metadata를 조회하고 public으로 전환한 뒤 visibility를 다시 확인한다.
5. 테스트 repository를 정리하고 조회 `404`로 삭제를 확인한다.

이 smoke의 PASS와 공개-safe 증거 첨부를 PR #204의 Draft 해제 조건으로 사용한다.

Collection App의 E1 smoke는 commit, all-state PR, published release가 준비된 public 합성 repository와 private 합성 repository에서 수행한다.
API 호출 전에 test App의 installation 설정과 token 발급 결과에서 repository·organization permission map과 repository selection을 정규화한다.
repository permission은 `Metadata: read`, `Contents: read`, `Pull requests: read`만, organization permission은 없음, repository selection은 `All repositories`여야 하며 webhook URL·event subscription이 없고 allowlist 밖 권한이 하나라도 있으면 FAIL한다.
그 뒤 실제 installation token으로 두 합성 repository의 metadata·default-branch commit·all-state PR·published release 조회가 각각 성공하고 각 repository의 stream이 `READY`로 승격되는지 확인한다.
권한 오설정 시 실제 변경이 생길 수 있는 write 요청은 최소 권한 검증에 사용하지 않는다.

공개 증거에는 정규화된 permission map, repository selection, webhook 미설정 여부, endpoint 종류, status code, 합성 fixture 구분, UTC 시각, backfill/incremental 결과만 남긴다.
token, secret, header, private key, 실제 organization·repository·사용자 데이터, private 식별 정보는 증거에 포함하지 않는다.
현재 live smoke는 승인된 비운영 org, 역할별 test App, org owner의 설치·권한 승인 경로, public/private 합성 repository, secret store 주입이 준비되지 않아 대기 상태다.
PM 결정으로 ADR은 `Accepted`이지만 이 상태 변경이 실제 App 설치나 Collection REST 누적·증분 수집과 #121 구현 검증을 완료했다는 뜻은 아니다.
비운영 경로가 지정되기 전까지 두 App 연동은 fail-closed이며 live smoke는 구현 검증 blocker로 남는다.

## Alternatives considered

### 사용자 OAuth token 권한 확장

- Pros: 기존 로그인 흐름을 재사용할 수 있다.
- Cons: 조직 자동화가 특정 사용자 로그인·동의·token 수명에 의존하고 로그인 credential과 write 자동화 경계가 합쳐진다.
- **Rejected:** 학생 사용자 token으로 write API를 호출하지 않는 저장소 보안 규칙과 맞지 않는다.

### fine-grained PAT와 서비스 계정

- Pros: 초기 호출 구현은 단순하다.
- Cons: 개인 또는 서비스 계정에 장기 credential과 수동 회전이 결합되고 installation 회수·repository 선택을 제공하지 못한다.
- **Rejected:** 조직 소유권, 짧은 수명 token, 최소 repository 권한을 관리하는 GitHub App보다 운영 의존성이 크고 Collection authority에 PAT를 허용할 수 없다.

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

### REST와 webhook hybrid 수집

- Pros: webhook으로 변경을 빠르게 반영하고 REST로 누락을 보정할 수 있다.
- Cons: 동일 사실에 두 authority와 서로 다른 멱등·checkpoint 계약이 생겨 atomic current-state generation을 보장하기 어렵다.
- **Rejected:** Collection App은 결정적인 단일 REST authority만 사용한다.

### webhook-only 수집

- Pros: 변경 시점에만 처리해 평상시 REST 호출량을 줄일 수 있다.
- Cons: 설치 전 상태, delivery 누락, 전체 all-state PR과 published release의 현재 상태를 완전하게 재구성할 수 없다.
- **Rejected:** Org-wide atomic current state와 bounded incomplete semantics를 충족하지 못한다.

### cutover와 rollback

C1에서 REST generation을 배포하되 current pointer는 기존 경로가 소유한 상태로 유지하고 public/private 합성 E1 결과를 비교한다.
C2에서 E1 통과 뒤 REST complete generation을 유일한 current pointer authority로 전환하고 Collection webhook URL·event subscription·secret을 제거한다.
M3에서 매시간 schedule과 기존 `ADMIN` manual trigger를 REST-only 경로로 고정하고 기존 webhook 수집 상태의 쓰기를 종료한다.
rollback은 M3 schedule 중지, C2 current pointer를 마지막 검증된 complete generation으로 복원, C1 REST generation 비활성화 순서로 수행하며 webhook credential이나 OAuth/PAT fallback을 되살리지 않는다.

## Consequences

### Enables

- #121은 Repository Operations App의 installation token client와 durable worker를 구현할 수 있다.
- Collection App은 매시간과 `ADMIN` manual trigger에서 신규 repository를 1회 backfill하고 기존 repository는 endpoint별 safe frontier로 변경분만 증분 수집해 누적 facts/aggregate를 갱신한다.
- Collection App installation token은 조직 repository의 metadata·default-branch commit·all-state pull request·published release를 읽을 수 있고 쓰기 권한은 갖지 않는다.
- platform-managed repository를 기존 `Repository` 관계에 매핑하고 unmapped Org repository는 가짜 program·team 관계 없이 처리한다.
- #125는 모든 필수 마일스톤 승인 뒤 별도 staff/admin action으로만 Repository Operations App의 공개 전환을 호출한다.
- 승인 시점 collaborator snapshot이 팀 변경과 worker 지연 사이의 의미 변화를 막는다.
- 조직 전체 REST read 권한과 platform-managed repository write/admin 권한의 credential과 installation을 분리한다.

### Costs / trade-offs

- test와 production에서 역할별 App 등록·private key를 따로 운영하고 각각 org owner 승인을 받아야 한다.
- Repository Operations App은 `Only select repositories`이므로 기존 platform-managed 저장소를 최초 설치 때 명시적으로 선택해야 한다.
- Collection App은 `All repositories` 설치이므로 새 Org repository가 수집 범위에 자동 포함된다.
- installation 회수·permission 변경과 token 만료를 운영 상태로 관찰해야 한다.
- live smoke가 완료될 때까지 #121과 Collection REST 누적·증분 수집의 실제 GitHub 연동 완료를 주장할 수 없다.

### New constraints

- #119 outbox payload는 `collaboratorGithubLogins` 승인 snapshot을 포함해야 한다.
- #121은 현재 Team 관계가 아니라 outbox snapshot을 초대 대상의 원본으로 사용한다.
- #121은 Repository Operations App만 사용하고 Collection generation은 Collection App만 사용한다.
- 두 경로는 실제 credential·header·raw REST response를 로그나 DB에 남기지 않는다.
- unmapped Org repository 처리는 program·team 가짜 매핑을 만들지 않는다.
- 공개 전환은 review 승인과 분리된 #125 staff/admin action이며 자동화하거나 학생에게 Org-wide visibility write 권한을 주지 않는다.
- 학생용 read-only 수집 App #15는 post-pilot이며 두 조직 App의 permission을 재사용하지 않는다.

## References

- [Issue #120: GitHub App 연동 스파이크/ADR](https://github.com/JNU-SWCU/oss-hub/issues/120)
- [Issue #15: 학생 설치용 read-only App](https://github.com/JNU-SWCU/oss-hub/issues/15)
- [Issue #36: Org 저장소 수집·가시성 경계](https://github.com/JNU-SWCU/oss-hub/issues/36)
- [Issue #119: 신청 승인과 durable outbox](https://github.com/JNU-SWCU/oss-hub/issues/119)
- [Issue #121: 저장소 provision worker](https://github.com/JNU-SWCU/oss-hub/issues/121)
- [Issue #123: 기존 webhook 수집 이력](https://github.com/JNU-SWCU/oss-hub/issues/123)
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
- [GitHub REST API rate-limit troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)

## Changelog

- 2026-07-21: Issue #120에 따라 조직 자동화 App의 인증·최소 권한·token·당시 webhook·후속 티켓 계약을 Proposed로 기록했다.
- 2026-07-21: Issue #36과 #120의 PM 결정에 따라 Org-wide read Collection App과 selected-repository write Operations App을 분리하고 파일럿 수집·소유권·공개 경계를 Accepted로 확정했다.
- 2026-07-22: Issue #205의 조건부 승인에 따라 Collection App의 `Pull requests: read`와 당시 REST read 및 webhook smoke 분리를 기록했다.
- 2026-07-25: Collection App authority를 webhook 없이 REST-only Org-wide atomic current-state generation으로 변경하고 권한, 주기, incomplete 한도, E1 smoke, C1/C2/M3 cutover와 rollback을 확정했으며 Repository Operations App write 계약은 변경하지 않았다.
- 2026-07-30: GitHub App 개인키 주입을 env 문자열에서 secret file 경로로 전환했다. env 값은 `docker compose config`, `docker inspect`, 프로세스 env 덤프에 평문으로 노출되므로 `Collection App`과 `Repository Operations App`의 private key는 호스트 secret file에서 읽게 하고, `SECRETS_DIR=/var/lib/oss-hub/secrets`·`jenkins:1000`·`2750` setgid·파일 `0640` 제약과 Compose v5.3.1의 호스트 소유/모드 전달 동작을 따른다. `uid`/`gid`/`mode`는 compose에 두지 않으며, legacy `GITHUB_*_APP_PRIVATE_KEY`는 R1 호환에서 R2 활성화로 넘어가는 2단계 배포의 rollback 안전판을 위해 아직 유지한다.
- 2026-07-31: hourly org-wide full-history generation을 조직 전체 누적·증분 수집 계약으로 교체했다. commit `(repositoryId, sha)`·PR `(repositoryId, githubPullRequestId)`·release `(repositoryId, githubReleaseId)` 누적 unique 지표, endpoint별 safe frontier와 연결 끊김/release probe 변경 시 해당 repository만의 예외적 complete scan, nullable exact-request ETag(`2022-11-28` fingerprint), 저장·폐기 field inventory, complete/partial inventory에 따른 공개 노출 revocation, serial rate budget과 durable continuation cursor, 이전 세대의 1회 backfill·parity 검증·원자 전환·한 release 보존 후 별도 제거를 명시했다. "private repository 식별 정보를 남기지 않는다"는 이전 서술이 내부 저장(DB)과 공개 노출 층을 구분하지 않아 실제 구현과 충돌하던 것을 두 층을 분리해 교정했다.
