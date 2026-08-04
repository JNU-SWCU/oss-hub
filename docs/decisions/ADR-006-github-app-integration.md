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

개인 계정 소유 repository의 REST 실체 수집(Collection App installation token 경로)은 파일럿 범위가 아니다.
단 학생이 명시적으로 등록한 조직 밖 public repository는 2026-08-04 개정 이후 별도 수집 전용 자격증명과 GraphQL discovery를 통해 수집 범위에 포함되며, 그 뒤의 commit·PR·release 상세 수집은 org와 동일한 REST 경로를 그대로 쓴다(아래 "조직 밖 public repository 수집" 절).
학생이 직접 설치하는 #15의 read-only App은 post-pilot 별도 결정으로 남기며 이 ADR의 credential이나 permission을 재사용하지 않는다 — 이는 2026-08-04에 추가된 수집 전용 서비스 계정 PAT와도 무관하다. #15는 학생이 직접 설치하는 App이고, 수집 전용 PAT는 서비스가 보유하며 학생 설치를 요구하지 않는다는 점이 다르다.

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

### 조직 밖 public repository 수집 — 외부 자격증명과 discovery

학생이 조직 밖에서 작업한 public repository도 추적 대상에 포함한다. 이 확장은 Collection App installation token의 수집 authority를 바꾸지 않고 그 옆에 별도 경로를 추가하는 방식으로만 이루어진다.

**두 번째 자격증명이 불가피한 이유.** GitHub 공식 문서는 installation access token의 접근 범위를 다음과 같이 못박는다.

> "The installation access token cannot be granted access to repositories that the installation was not granted access to."
> — [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)

GitHub App이 public 리소스에 암묵적 읽기 권한을 갖는다는 문구는 존재하지만 그 주어는 **user-to-server 토큰**(사용자가 앱을 authorize했을 때 발급되는 토큰)이며 이 ADR이 쓰는 **installation(server-to-server) token에는 적용되지 않는다**([Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)). REST와 GraphQL 모두 같은 installation 범위 규칙을 공유한다. 따라서 `JNU-SWCU` installation 범위 밖의 조직 밖 repository는 Collection App의 어떤 토큰으로도 구조적으로 읽을 수 없고, 별도 자격증명 없이는 이 확장이 성립하지 않는다.

**선택한 자격증명 — 서비스 계정 fine-grained PAT.** REST(상세 fact 수집)와 GraphQL(discovery) 양쪽을 같은 자격증명 하나로 처리한다.

**C2가 제거한 PAT 수집 경로와의 관계 — 범위가 다르다.** `apps/backend/src/collection/AGENTS.md`의 Purpose 문단은 "webhook·OAuth·PAT 수집 경로는 C2(#151, ADR-006)로 제거되었고 유일한 수집 authority는 REST reconciliation이다"라고 적고 있다. 이 문장의 근거는 이 ADR의 "Alternatives considered" 중 "cutover와 rollback" 항목(위 라인 381-386)이다 — C2는 "REST complete generation을 유일한 current pointer authority로 전환하고 Collection webhook URL·event subscription·secret을 제거"하는 결정이며, rollback 절차가 되살리지 않는 대상으로 "webhook credential이나 OAuth/PAT fallback"을 명시한다. 이 결정의 주어는 **`JNU-SWCU` installation 범위 안 조직 저장소를 읽는 Collection App의 current-pointer authority**다 — `collection/AGENTS.md` Purpose 문단 자신도 그 모듈의 수집 대상을 "조직 설치 범위의 저장소 전체(조직 밖·개인 계정 repo는 제외)"로 못박고 있어, 그 범위 밖은 애초에 이 문장의 대상이 아니다. 이번 절이 도입하는 서비스 계정 PAT(`GITHUB_PUBLIC_READ_TOKEN`)는 installation token이 구조적으로 닿지 않는 **조직 밖 public repository**만을 위한 별도 authority이며, 조직 저장소의 current-pointer authority를 PAT로 되돌리지 않는다 — 조직 저장소의 current-pointer는 여전히 Collection App installation token(REST reconciliation) 하나뿐이다. 따라서 이번 PAT 도입은 C2를 번복(supersede)하지 않는다: C2가 제거한 것은 "조직 수집 authority로서의 webhook·OAuth·PAT"이고, 이번 PAT는 애초에 C2의 대상이 아니었던 별도 스코프(조직 밖 수집)의 신규 authority다.

`collection/AGENTS.md` Purpose 문단은 이 스코프 구분을 명시하지 않는다 — "PAT 수집 경로는 C2로 제거됐다"만 읽으면 이번 PAT 도입과 모순으로 보일 여지가 있다. **그 문서와 이 ADR의 서술이 함께 갱신돼야 한다**: `collection/AGENTS.md` Purpose 문단에 "조직 밖 public repository 수집은 별도 authority(서비스 계정 PAT, `GITHUB_PUBLIC_READ_TOKEN`)를 쓰며, C2가 제거한 것은 조직 수집 authority로서의 webhook·OAuth·PAT다"라는 취지의 스코프 한정 문구를 추가해야 한다. `collection/AGENTS.md`는 `collection` 모듈 소유 레인의 파일이므로 이 ADR에서 직접 고치지 않는다 — 갱신 필요성만 여기 기록해 둔다.

**Issue #151 원문으로 재확인한 근거.** C2가 실제로 무엇을 제거했는지는 이 ADR 내부 서술만으로는 "C2(#151, ADR-006)"이라는 출처 표기의 배경까지 다 설명하지 못하므로 Issue #151 본문·코멘트를 직접 확인했다. #151("백엔드: GitHub 저장소 주기 수집 스케줄러")의 원래 범위는 **당시 기존 인증 방식**(GitHub App 이전의 collection.service.ts/github-api.client.ts 경로, `CollectionRun`/`GithubRawObservation` 테이블 기반의 조직 저장소 배치 수집)의 스케줄러화였고, "GitHub App 전환 — #120 소관. 이 티켓은 현재 인증 방식을 그대로 사용한다"고 명시해 GitHub App 전환 자체를 이 티켓 범위 밖으로 못박았다. 이후 코멘트에서 구현 범위가 GitHub App REST-only 전환까지 확장됐고, 마지막 코멘트("E1 완료... Collection App 실설치·REST-only 수집·공개/비공개 경계·2-instance lease·live smoke PASS까지 실증되어 C1 확인 후 C2 retirement를 진행합니다")가 C2를 명시적으로 **"retirement"**로 표현한다. 즉 C2는 "조직 저장소를 수집하던 **기존** webhook·OAuth·PAT 경로(당시 `collection.service.ts`/`github-api.client.ts`)를 퇴역시키고 Collection App installation token REST-only로 일원화"한 결정이다 — #151 티켓 어디에도 조직 밖·개인 계정 public repository 수집이라는 개념 자체가 등장하지 않는다(그 개념은 이후 `.omc/plans/github-repository-unification.md`에서 나왔다). 이 ADR "endpoint와 최소 권한" 절의 "Collection App의 유일한 수집 authority는 installation token을 사용하는 GitHub REST API이며 webhook, OAuth, PAT 경로를 병행하거나 fallback으로 사용하지 않는다"(위 112행)라는 문장도 주어가 **"Collection App"**으로 명시돼 있고, 바로 다음 절 "조직 전체 누적·증분 수집" 첫 문단이 "조직 밖 repository와 개인 계정 소유 repository는 이 범위 밖이다"(위 119행)라고 스스로 선을 긋는다. 세 근거(Issue #151 원문, ADR 112행, ADR 119행)가 모두 같은 결론을 가리키므로 **판정은 1번(범위 명확화)이다 — 2번(전면 금지 supersede)이 아니다.** 새 결정이 C2를 뒤집는 것이 아니라, C2가 애초에 다루지 않은 스코프(조직 밖 수집)에 별도 authority를 신설하는 것이다.

**forbidden fields·public-evidence 제약과의 관계.** "저장·폐기 field inventory" 절은 "조직 밖 public repository의 수집도 위 field inventory를 그대로 따른다 — 저장하는 field는 org repository와 동일하며, 앞 절의 확장이 새 field를 추가하지 않는다"(위 225행)고 이미 명시해, PAT로 수집하는 필드도 raw response·code·diff·commit message·author email·PR title/body·release body 저장 금지를 포함해 org 경로와 동일한 forbidden-field 목록을 그대로 따른다 — PAT 도입이 저장 범위를 넓히지 않는다. "공개 노출과 complete/partial inventory" 절(위 229-236행)의 공개 API 노출·fail-closed·partial inventory 규칙은 `source` 컬럼으로 조건 분기하지 않고 저장소 단위로 동일하게 적용되는 일반 규칙이라 `EXTERNAL_PUBLIC` 행에도 동일하게 적용된다 — 이 절은 org/외부를 구분해 서술하지 않으므로 별도 예외가 없다는 뜻이며, 명시적으로 "외부에도 동일 적용"이라고 못박는 문장은 이전에 없었다. 이 점을 여기 명시해 향후 읽는 사람이 암묵적 추론에 의존하지 않게 한다.

> "Tokens always include read-only access to all public repositories on GitHub."
> — [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

fine-grained PAT는 repository selection이나 permission 설정과 무관하게 모든 public repository에 대한 read-only 접근을 항상 포함한다. 따라서 조직 밖 학생 저장소를 하나씩 permission에 등록하지 않아도 이 확장이 필요로 하는 public repository read가 성립한다. rate limit은 인증된 사용자 기준이다.

> "All of these requests count towards your personal rate limit of 5,000 requests per hour."
> — [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

**OAuth App client ID·secret Basic Auth를 먼저 검토했다가 채택하지 않은 이유 — 정정 기록.** REST 문서에 OAuth App이 client ID·client secret을 HTTP Basic Auth 헤더로 실어 public 데이터를 5,000 requests/hour까지 읽을 수 있다는 조항이 있어(위 rate-limits 문서) 만료 관리가 없는 자격증명으로 한 차례 검토했으나, **GraphQL에는 적용되지 않아** 자격증명이 둘로 갈라지므로 채택하지 않았다. 구체적으로는 `lane-graphql`이 discovery client를 구현하며 확인한 사실대로, OAuth App의 client ID·secret Basic Auth는 REST 전용으로 문서화된 기전이고 GraphQL v4는 이를 받지 않으며 실제 인증 주체에 묶인 bearer token을 요구한다. 이 확장은 discovery에 GraphQL을, 상세 수집에 REST를 함께 쓰므로 OAuth App Basic Auth를 선택해도 GraphQL 몫으로 PAT를 어차피 하나 더 들여야 한다 — OAuth App을 검토한 유일한 근거였던 "만료 관리 불필요"는 사라지고 자격증명 개수만 둘로 늘어나는 순손해가 된다. 이 검토·기각 근거는 "Alternatives considered"의 "조직 밖 public repository 수집 — OAuth App client ID·secret Basic Auth" 항목에도 남겨 같은 검토를 반복하지 않게 한다.

**PAT 발급·회전은 운영 부담으로 남는다.** installation token과 달리 PAT는 만료·회전을 서비스가 직접 관리해야 하는 장기 자격증명이다. 이 부담을 다음으로 완화한다.

- 사업단 **서비스 계정**으로 발급한다 — 개인 계정으로 발급하면 그 사람이 조직을 떠날 때 수집이 함께 끊기고, public repository read 권한을 가진 개인 계정이라는 사실 자체가 실명 노출 위험이 된다.
- 만료일과 회전 담당자를 운영 문서(Obsidian 운영 인벤토리의 secret store record)에 명시한다 — 토큰 값 자체는 여기에도 기록하지 않는다.
- 부재·만료 시 **fail-closed**로 명시적으로 거부한다. 조용히 skip해 조직 밖 public repository 수집만 빠지는 상태를 만들지 않는다 — 조용한 skip은 "랭킹이 0인데 아무도 모르는" 상태를 만든다.

이 PAT는 학생 로그인에 쓰는 `GITHUB_OAUTH_*` App과 **별개**다. 재사용하면 로그인 인증 사고로 시크릿을 rotate할 때 수집도 함께 죽고, quota가 로그인 트래픽과 섞인다. 별도 발급으로 두 축의 장애와 quota를 분리한다. env 키는 `GITHUB_PUBLIC_READ_TOKEN` 하나로 REST·GraphQL 양쪽 호출에 공용으로 쓴다 — 기존 `GITHUB_OAUTH_*`(학생 로그인), `GITHUB_COLLECTION_APP_*`(조직 수집), `GITHUB_OPERATIONS_APP_*`(저장소 provisioning)와 구별되는 새 이름이다.

**바뀌지 않는 경계.** 수집 대상은 public repository만이다. 학생 access token은 이 경로에서도 저장하지 않는다 — 이 ADR이 이미 확정한 절대 원칙이며 이번 확장으로도 흔들리지 않는다. 학생 token을 모아 rate limit을 늘리는 방식은 검토 대상이 아니었으며, GitHub Terms of Service Section H가 "rate limit 회피를 위한 token 공유"를 금지하므로 우리 판단과 무관하게 정책으로도 막혀 있다.

**GraphQL의 역할은 discovery뿐이다.** 조직 밖 repository 목록(`nameWithOwner`)을 얻는 데만 GraphQL `contributionsCollection`을 쓰고, 그 목록을 얻은 뒤의 commit·PR·release 상세 수집은 위 "endpoint와 최소 권한" 표의 기존 REST 경로를 그대로 재사용한다. discovery의 자격증명도 위 서비스 계정 PAT(`GITHUB_PUBLIC_READ_TOKEN`)를 그대로 쓴다 — **미확인:** installation token으로 `user(login:)`·`contributionsCollection`처럼 installation 범위 밖 사용자에 대한 최상위 필드를 조회할 수 있는지는 GraphQL 문서·GitHub Apps 인증 문서 어느 쪽에도 허용·차단이 명시되어 있지 않다. 이 미확인 항목에 기능을 의존시키지 않기 위해 discovery도 installation token이 아니라 위 PAT로 통일한다.

### 동의 범위 게이트 — 수집 활성화는 동의 문서 개정 이후에만 가능하다

**현재 라이브 동의 문서는 개인 계정 소유 저장소를 명시적으로 수집 범위에서 제외하고 있다.** `CONSENT_POLICY_VERSION`(`apps/backend/src/consents/domain/consent-policy.ts:8`)이 가리키는 `2026-07-21` 버전의 GitHub 활동 동의 문서(`apps/frontend/public/policies/github-activity/2026-07-21.html:14-18`; 같은 디렉터리에 다른 버전 파일은 없으므로 이 버전이 유일한 라이브 버전이다)는 다음과 같이 쓰여 있다.

> "JNU-SWCU Org 저장소의 식별자·가시성, 활동 시각·종류와 저장소 단위 최소 집계값을 프로그램 운영과 커뮤니티 활성화 지표 산출에 사용합니다. 개인 계정 소유 저장소는 이 정책의 수집 대상이 아닙니다."

학생은 이 문구에 동의한 상태다. 이 ADR이 설계하는 조직 밖 public repository 수집은 정확히 이 문구가 제외한 대상(개인 계정 소유 저장소)을 수집 대상으로 삼는다 — 설계와 현재 라이브 동의 범위가 정면으로 어긋난다.

**노출 경로.** `GET /ranking`(`apps/backend/src/ranking/ranking.controller.ts:12,16`)은 인증 guard가 없는 비인증 공개 endpoint다. `RankingService`(`apps/backend/src/ranking/ranking.service.ts:110-111`)의 `displayName`은 학생의 실명(`user.name`)이 있으면 실명을 우선하고 없을 때만 `githubLogin`으로 폴백한다. 따라서 이 확장이 활성화되면 학생의 개인 계정·서드파티 OSS 활동이 실명과 함께 비인증 공개 페이지에 집계 노출된다.

**이 게이트는 머지 게이트가 아니라 활성화 게이트다 — 구분을 흐리지 않는다.** 이 제약은 스키마·discovery client·REST 상세 수집 배선을 머지하는 것을 막지 않는다. 그 자체로는 아무것도 수집하지 않기 때문이다 — 현재 `CollectionDiscoveryClient`는 어떤 모듈에도 provider로 등록돼 있지 않고(`collection.module.ts` 미참조), `CollectionSyncService.runExternal()`은 `externalRuntimeFactory`가 주입되지 않으면 즉시 실패하도록 만들어져 있으며 어떤 스케줄러·컨트롤러도 이를 호출하지 않는다. `EXTERNAL_PUBLIC` source 행을 만들어내는 자동 discovery(GraphQL) 경로도 아직 구현되어 있지 않다 — 즉 이 파이프라인은 현재 구조적으로 inert하다. 이 게이트가 막는 것은 머지가 아니라 **`EXTERNAL_PUBLIC` 행을 실제로 만들어내는 경로의 활성화**(discovery client를 provider로 등록하고 `externalRuntimeFactory`를 배선해 스케줄러에 연결하는 것)다.

**제약(New constraint).** 조직 밖 public repository 수집 활성화(=`EXTERNAL_PUBLIC` 행을 만들어내는 코드 도입)는 GitHub 활동 동의 문서 개정과 `CONSENT_POLICY_VERSION` 상향 이후에만 가능하다. 버전 상향은 재동의 흐름을 발생시킨다. 근거: 이미 실명과 함께 공개 노출된 뒤에 뒤늦게 재동의를 받는 것으로는 그 노출을 되돌릴 수 없다 — 따라서 활성화보다 동의 갱신이 먼저다.

**미결(open question) — 이 ADR은 결정하지 않는다.** 외부 수집을 기존 `GITHUB_ACTIVITY` 동의 항목의 문구 개정으로 흡수할지, 별도 동의 항목(예: 조직 밖 public repository 전용 opt-in)으로 분리할지는 이 ADR이 고르지 않는다. 이는 프로그램 운영 정책 판단이며 PM/운영이 결정할 몫이다.

**별건 — 정책 결정 D3(공개 표기를 GitHub nickname으로 단일화) 미구현.** `.omc/plans/github-repository-unification.md` §11 미결 항목이 "D3(공개 표기 = GitHub nickname 단일화)"로 지칭하는 결정이다(같은 문서 §7 단계 D 작업표의 "D3 | `Repository` 삭제"와는 다른 항목이며 식별자가 중복되어 있으니 혼동하지 않는다). 이 결정이 구현되면 `RankingService.buildEntries`(위 `ranking.service.ts:110-111`)의 실명 우선 표기가 `githubLogin` 단일 표기로 바뀌어, 위 실명 노출 위험이 동의 문서 개정과 별개의 경로로 줄어든다. **D3는 아직 구현되지 않았고, 이 ADR 개정도 D3를 구현하지 않는다** — 미구현 사실과 구현 시 효과만 기록해 둔다.

### 저장·폐기 field inventory

내부 저장(DB)은 collection 범위 판별과 누적 집계에 필요한 아래 field에 한정한다.

- repository: `githubRepositoryId`, 조직 내 repository 이름, **visibility(private/public)**, default branch, mapped/unmapped 상태.
- commit fact: `(repositoryId, sha)`, 발생 시각. commit message·author email·diff·code 내용은 저장하지 않는다.
- PR fact: `(repositoryId, githubPullRequestId)`, 관측 시각. title·body는 저장하지 않는다.
- release fact: `(repositoryId, githubReleaseId)`, 발생 시각. body는 저장하지 않는다.
- 집계: repository/contributor 단위 commit·PR·release 누적 count, 마지막 관측 시각(watermark/frontier), stream 상태.

raw response, code·diff, commit message·author email, pull request title·body, release body, 사용자 profile, credential(JWT/private key/installation token)은 DB·cache·로그·공개 smoke artifact 어디에도 남기지 않는다.
repository의 `githubRepositoryId`·이름·visibility는 내부 collection DB에는 저장하지만, **공개 API 응답과 공개 smoke artifact에는** private repository의 식별 정보(이름, 존재 여부, visibility)를 노출하지 않는다 — "private repository 식별 정보를 남기지 않는다"는 이전 서술은 내부 저장과 공개 노출을 구분하지 않아 실제 구현과 충돌했으므로 위와 같이 층을 분리해 교정한다.

조직 밖 public repository의 수집도 위 field inventory를 그대로 따른다 — 저장하는 field는 org repository와 동일하며, 앞 절의 확장이 새 field를 추가하지 않는다.

**귀속(attribution) 신호의 신뢰도 — field inventory의 결과로 생기는 한계.** commit 응답의 최상위 `author`(GitHub 계정 매핑)는 커밋에 쓰인 이메일이 그 계정에 **등록되어 있을 때만** 채워진다. 이 ADR은 raw commit author email을 저장하지 않으므로(위 field inventory), 이메일을 GitHub 계정에 등록하지 않은 학생의 commit은 어떤 학생에게도 귀속시킬 방법이 없다 — 이메일로 추측 매칭하는 것은 이 field inventory 위반이므로 시도하지 않는다. 반면 PR(`pulls[].user.login`)과 release는 항상 GitHub 계정 기반이라 계정이 삭제된 경우를 제외하면 귀속이 always-on이다. 따라서 랭킹·기여 집계는 PR·release를 **1차 attribution 신호**로 삼고, commit의 `author.login`은 이메일이 등록된 경우에만 채워지는 **보조 신호**로 삼는다. 이는 스키마 변경이 아니라 집계·랭킹 해석 규칙이며, commit만으로 기여를 완전히 재구성할 수 없다는 correctness 한계를 이 ADR에 명시적으로 기록해 둔다. 학생에게는 "commit이 집계되려면 GitHub 계정에 commit 이메일을 등록해야 한다"는 안내가 별도 화면에 필요하다.

### 공개 노출과 complete/partial inventory

공개 API는 platform publication 조건과 **최신 complete Collection inventory 관측**을 함께 통과해야 노출한다.
`publishedAt` 이후 시점에 관측된 private/missing 상태는 즉시 공개를 차단(fail-closed)한다.
publication 이전의 오래된 private 관측은 방금 완료된 managed publication을 막지 않는다.
partial inventory(page/시간/rate limit/권한 오류로 일부만 관측)는 missing 판정의 증거로 쓰지 않는다 — activity stream 실패와 visibility/presence 안전 관측은 별도 fenced transaction으로 분리한다.

후속 REST client 테스트는 endpoint별 safe frontier와 예외적 complete scan, exact-request ETag의 nullable 특성과 fingerprint 비공유, 100-page 한도, 허용 필드 저장·금지 필드 미저장, 부분 실패 시 checkpoint 미승격, complete/partial inventory에 따른 공개 노출 revocation까지 검증해야 한다.

이 절의 규칙은 `source`(`ORG_PROVISIONED`/`EXTERNAL_PUBLIC`) 값으로 조건 분기하지 않고 저장소 단위로 동일하게 적용된다 — 조직 밖 public repository 수집(서비스 계정 PAT 경로)으로 채워진 `EXTERNAL_PUBLIC` 행에도 publication 조건·fail-closed·partial inventory 비-missing 판정 규칙이 예외 없이 그대로 적용된다.

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
- **Rejected:** 조직 소유권, 짧은 수명 token, 최소 repository 권한을 관리하는 GitHub App보다 운영 의존성이 크고 Collection authority에 PAT를 허용할 수 없다. (이 판단은 조직 소유 repository를 읽는 Collection authority에 한정된다 — installation token이 애초에 닿지 않는 조직 밖 public repository 수집의 자격증명 선택은 아래 "조직 밖 public repository 수집" 절 및 "조직 밖 public repository 수집 — OAuth App client ID·secret Basic Auth" 대안에서 별도로 다룬다.)

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

### 조직 밖 public repository 수집 — OAuth App client ID·secret Basic Auth

- Pros: 만료 관리가 없는 자격증명이다. REST 문서에 OAuth App이 client ID·client secret을 HTTP Basic Auth 헤더로 실어 public 데이터를 5,000 requests/hour까지 읽을 수 있다는 조항이 있다([Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
- Cons: 이 방식은 REST 전용으로 문서화된 기전이며 GraphQL v4는 OAuth App의 client ID·secret Basic Auth를 받지 않고 실제 인증 주체에 묶인 bearer token을 요구한다. 이 확장은 discovery에 GraphQL을, 상세 수집에 REST를 함께 쓰므로 OAuth App을 선택해도 GraphQL 몫으로 PAT를 별도로 들여야 해 자격증명이 REST용·GraphQL용 둘로 갈라진다.
- **Rejected:** 유일한 채택 근거였던 "만료 관리 불필요"가 GraphQL 몫 PAT 도입으로 사라지고 자격증명 개수만 둘로 늘어나는 순손해이므로 채택하지 않는다. `lane-graphql`이 discovery client 구현 중 GraphQL v4의 OAuth App Basic Auth 미지원을 확인해 이 결정을 뒤집었다(2026-08-04).
- 검토 당시 정리해 둔 근거(흔적 보존): 2021-05-05에 폐기된 것은 client ID·client secret을 **쿼리 파라미터**로 보내는 방식(`?client_id=&client_secret=`, `?access_token=`)이며, **HTTP Basic Auth 헤더 방식은 폐기되지 않았다** — 이 둘을 혼동해 "폐기됐다"고 서술한 자료가 흔하므로 검토 당시 정확한 근거로 기록해 뒀던 내용이다. 또한 채택했다면 학생 로그인용 `GITHUB_OAUTH_*` App과 별개로 새로 등록해 로그인 시크릿 rotate가 수집에 영향을 주지 않도록 분리할 계획이었다. 최종적으로 PAT를 선택하며 이 등록 계획은 실행하지 않았다.

## Consequences

### Enables

- #121은 Repository Operations App의 installation token client와 durable worker를 구현할 수 있다.
- Collection App은 매시간과 `ADMIN` manual trigger에서 신규 repository를 1회 backfill하고 기존 repository는 endpoint별 safe frontier로 변경분만 증분 수집해 누적 facts/aggregate를 갱신한다.
- Collection App installation token은 조직 repository의 metadata·default-branch commit·all-state pull request·published release를 읽을 수 있고 쓰기 권한은 갖지 않는다.
- platform-managed repository를 기존 `Repository` 관계에 매핑하고 unmapped Org repository는 가짜 program·team 관계 없이 처리한다.
- #125는 모든 필수 마일스톤 승인 뒤 별도 staff/admin action으로만 Repository Operations App의 공개 전환을 호출한다.
- 승인 시점 collaborator snapshot이 팀 변경과 worker 지연 사이의 의미 변화를 막는다.
- 조직 전체 REST read 권한과 platform-managed repository write/admin 권한의 credential과 installation을 분리한다.
- 학생이 조직 밖에서 작업한 public repository의 commit/PR/release 실체를 org와 동일한 REST 상세 수집 경로로 확보할 수 있다. GraphQL은 그 대상 repository 목록을 얻는 discovery 전용으로만 쓰인다.

### Costs / trade-offs

- test와 production에서 역할별 App 등록·private key를 따로 운영하고 각각 org owner 승인을 받아야 한다.
- Repository Operations App은 `Only select repositories`이므로 기존 platform-managed 저장소를 최초 설치 때 명시적으로 선택해야 한다.
- Collection App은 `All repositories` 설치이므로 새 Org repository가 수집 범위에 자동 포함된다.
- installation 회수·permission 변경과 token 만료를 운영 상태로 관찰해야 한다.
- live smoke가 완료될 때까지 #121과 Collection REST 누적·증분 수집의 실제 GitHub 연동 완료를 주장할 수 없다.
- 조직 밖 public repository 수집을 위해 세 번째 GitHub 자격증명(서비스 계정 fine-grained PAT, env `GITHUB_PUBLIC_READ_TOKEN`)을 새로 발급·운영해야 하며 시크릿 취급은 기존 App private key와 동일 등급으로 관리해야 한다.
- PAT는 installation token과 달리 만료·회전을 서비스가 직접 관리해야 하는 장기 자격증명이다 — 만료일·회전 담당자를 운영 문서에 명시하고, 부재·만료 시 조용히 skip하지 않고 fail-closed로 명시적 거부해야 한다.
- commit만으로는 기여자 귀속을 완전히 재구성할 수 없다 — 이메일이 GitHub 계정에 등록되지 않은 commit은 랭킹에서 무귀속으로 남는다(PR·release가 1차 신호).

### New constraints

- #119 outbox payload는 `collaboratorGithubLogins` 승인 snapshot을 포함해야 한다.
- #121은 현재 Team 관계가 아니라 outbox snapshot을 초대 대상의 원본으로 사용한다.
- #121은 Repository Operations App만 사용하고 Collection generation은 Collection App만 사용한다.
- 두 경로는 실제 credential·header·raw REST response를 로그나 DB에 남기지 않는다.
- unmapped Org repository 처리는 program·team 가짜 매핑을 만들지 않는다.
- 공개 전환은 review 승인과 분리된 #125 staff/admin action이며 자동화하거나 학생에게 Org-wide visibility write 권한을 주지 않는다.
- 학생용 read-only 수집 App #15는 post-pilot이며 두 조직 App의 permission을 재사용하지 않는다.
- 조직 밖 public repository 수집 활성화(`EXTERNAL_PUBLIC` 행을 만들어내는 코드 도입)는 GitHub 활동 동의 문서(`apps/frontend/public/policies/github-activity/`) 개정과 `CONSENT_POLICY_VERSION` 상향 이후에만 가능하다 — 현재 라이브 문서(`2026-07-21.html`)가 "개인 계정 소유 저장소는 이 정책의 수집 대상이 아닙니다"라고 명시하고 있기 때문이다. 이 제약은 스키마·discovery client·REST 배선의 머지를 막지 않으며, 활성화(자동 discovery를 provider로 등록·배선)만 막는다.
- 조직 밖 public repository 수집은 서비스 계정이 발급한 fine-grained PAT(env `GITHUB_PUBLIC_READ_TOKEN` 하나로 REST·GraphQL 공용)만 사용하며 학생 로그인용 `GITHUB_OAUTH_*` App이나 학생 access token을 재사용하지 않는다.
- discovery(GraphQL `contributionsCollection`)는 installation token이 아니라 위 서비스 계정 PAT를 사용한다 — installation token의 GraphQL 최상위 필드 조회 범위가 문서로 확정되지 않았기 때문이다(미확인).
- 조직 밖 public repository 수집용 PAT는 C2가 제거한 "조직 수집 authority로서의 webhook·OAuth·PAT"를 되살리는 것이 아니다 — C2의 범위는 조직 저장소 current-pointer authority에 한정되며 이번 PAT는 그 범위 밖(조직 밖 public repository)의 별도 authority다. `apps/backend/src/collection/AGENTS.md` Purpose 문단은 이 스코프 구분을 아직 명시하지 않으므로, 그 문서의 "webhook·OAuth·PAT 수집 경로는 C2로 제거되었다" 문장에 스코프 한정 문구를 추가하는 갱신이 함께 이뤄져야 한다(해당 파일은 `collection` 모듈 소유 레인이 갱신한다 — 이 ADR에서 직접 고치지 않는다).

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
- [Authenticating as a GitHub App installation](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-as-a-github-app-installation)
- [Generating a GitHub App JWT](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app)
- [Generating an installation access token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
- [Installing a GitHub App](https://docs.github.com/en/apps/using-github-apps/installing-a-github-app-from-a-third-party)
- [GitHub REST API rate-limit troubleshooting](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)
- [Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- [Choosing permissions for a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [GitHub Terms of Service](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
- `.omc/plans/github-repository-unification.md` (내부 계획 문서, §4 데이터 수집 설계가 이번 개정의 원본)

## Changelog

- 2026-07-21: Issue #120에 따라 조직 자동화 App의 인증·최소 권한·token·당시 webhook·후속 티켓 계약을 Proposed로 기록했다.
- 2026-07-21: Issue #36과 #120의 PM 결정에 따라 Org-wide read Collection App과 selected-repository write Operations App을 분리하고 파일럿 수집·소유권·공개 경계를 Accepted로 확정했다.
- 2026-07-22: Issue #205의 조건부 승인에 따라 Collection App의 `Pull requests: read`와 당시 REST read 및 webhook smoke 분리를 기록했다.
- 2026-07-25: Collection App authority를 webhook 없이 REST-only Org-wide atomic current-state generation으로 변경하고 권한, 주기, incomplete 한도, E1 smoke, C1/C2/M3 cutover와 rollback을 확정했으며 Repository Operations App write 계약은 변경하지 않았다.
- 2026-07-30: GitHub App 개인키 주입을 env 문자열에서 secret file 경로로 전환했다. env 값은 `docker compose config`, `docker inspect`, 프로세스 env 덤프에 평문으로 노출되므로 `Collection App`과 `Repository Operations App`의 private key는 호스트 secret file에서 읽게 하고, `SECRETS_DIR=/var/lib/oss-hub/secrets`·`jenkins:1000`·`2750` setgid·파일 `0640` 제약과 Compose v5.3.1의 호스트 소유/모드 전달 동작을 따른다. `uid`/`gid`/`mode`는 compose에 두지 않으며, legacy `GITHUB_*_APP_PRIVATE_KEY`는 R1 호환에서 R2 활성화로 넘어가는 2단계 배포의 rollback 안전판을 위해 아직 유지한다.
- 2026-07-31: hourly org-wide full-history generation을 조직 전체 누적·증분 수집 계약으로 교체했다. commit `(repositoryId, sha)`·PR `(repositoryId, githubPullRequestId)`·release `(repositoryId, githubReleaseId)` 누적 unique 지표, endpoint별 safe frontier와 연결 끊김/release probe 변경 시 해당 repository만의 예외적 complete scan, nullable exact-request ETag(`2022-11-28` fingerprint), 저장·폐기 field inventory, complete/partial inventory에 따른 공개 노출 revocation, serial rate budget과 durable continuation cursor, 이전 세대의 1회 backfill·parity 검증·원자 전환·한 release 보존 후 별도 제거를 명시했다. "private repository 식별 정보를 남기지 않는다"는 이전 서술이 내부 저장(DB)과 공개 노출 층을 구분하지 않아 실제 구현과 충돌하던 것을 두 층을 분리해 교정했다.
- 2026-08-04: 학생이 명시적으로 등록한 조직 밖 public repository의 수집 범위를 추가했다. installation access token은 installation 범위 밖 repository에 접근할 수 없다는 GitHub 공식 문서를 근거로, 수집 전용 GitHub OAuth App(client ID·client secret HTTP Basic Auth, 학생 로그인용 `GITHUB_OAUTH_*` App과 별도 등록)을 두 번째 자격증명으로 도입했다. HTTP Basic Auth 헤더 방식은 2021-05-05 폐기 대상(쿼리 파라미터 방식)이 아님을 명시해 흔한 오해를 정정했다. GraphQL `contributionsCollection`은 저장소 목록을 얻는 discovery 전용으로만 쓰고, 그 뒤의 commit·PR·release 상세 수집은 기존 REST 경로를 org repository와 동일하게 재사용한다 — 따라서 조직 밖 repository도 org와 동일한 fact 행을 갖는다. public 전용 수집·학생 access token 미저장 원칙은 그대로 유지했고, GitHub Terms of Service Section H의 token-pooling 금지도 재확인했다. installation token으로 installation 범위 밖 사용자의 GraphQL 최상위 필드(`user(login:)` 등)를 조회할 수 있는지는 문서로 확정되지 않아(미확인) discovery에도 installation token 대신 수집 전용 자격증명을 재사용해 이 미확인 항목에 대한 의존을 없앴다. field inventory에 이메일 미등록 commit의 귀속 불가 문제를 기록하고, PR·release를 1차 attribution 신호로, commit을 보조 신호로 삼는 랭킹 해석 규칙을 명시했다. 기존 field inventory·private 데이터 비저장 원칙은 변경하지 않았다.
- 2026-08-04: 위 항목에서 도입한 조직 밖 public repository 수집 자격증명을 **수집 전용 OAuth App(client ID·client secret HTTP Basic Auth)에서 서비스 계정 fine-grained PAT로 정정**했다. 근거: `lane-graphql`이 discovery client를 구현하며 GitHub GraphQL v4가 OAuth App의 client ID·secret Basic Auth를 받지 않음을 확인했다 — 그 방식은 REST 전용으로 문서화된 기전이고 GraphQL은 실제 인증 주체에 묶인 bearer token을 요구한다. 이 확장은 REST(상세 수집)와 GraphQL(discovery)을 함께 쓰므로 OAuth App을 선택해도 GraphQL 몫 PAT를 별도로 들여야 해 자격증명이 둘로 갈라진다 — OAuth App을 검토한 유일한 근거였던 "만료 관리 불필요"가 사라지고 자격증명 개수만 둘로 늘어나는 순손해이므로 채택하지 않는다. 이 검토·기각 근거와 misconception 정정(2021-05-05 폐기 대상은 쿼리 파라미터 방식이지 Basic Auth 헤더 방식이 아니라는 기록)은 지우지 않고 "Alternatives considered"의 "조직 밖 public repository 수집 — OAuth App client ID·secret Basic Auth" 항목으로 옮겨 흔적을 남겼다. 새 자격증명은 서비스 계정이 발급한 fine-grained PAT 하나이며 "Tokens always include read-only access to all public repositories on GitHub"([Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens))를 근거로 REST·GraphQL 양쪽에 공용으로 쓴다. env 키는 `GITHUB_PUBLIC_READ_TOKEN` 하나로 확정했다 — "구현 PR에서 정한다"던 이전 서술을 대체한다. PAT는 installation token과 달리 만료·회전을 서비스가 직접 관리해야 하므로, 사업단 서비스 계정 발급(개인 계정 금지 — 이탈 시 수집 중단, public repo 실명 노출 위험), 만료일·회전 담당자의 운영 문서 기록, 부재·만료 시 fail-closed 명시적 거부(조용한 skip 금지 — 랭킹이 0인데 아무도 모르는 상태 방지)를 완화책으로 명시했다. installation token 범위 제약이 두 번째 자격증명을 요구하는 근본 이유라는 기록, GraphQL discovery-only 원칙과 installation token의 GraphQL 최상위 필드 조회 가능 여부 미확인 기록, 학생 access token 미저장 원칙과 ToS Section H 재확인은 모두 그대로 유지했다 — 이번 정정은 자격증명의 종류만 바꾼다. ADR-003 DEC-42 개정은 자격증명 종류와 무관하므로 이 정정의 영향을 받지 않는다.
- 2026-08-04: 감사 결과에 따라 **"동의 범위 게이트"** 절을 추가했다. `CONSENT_POLICY_VERSION`이 가리키는 라이브 GitHub 활동 동의 문서(`apps/frontend/public/policies/github-activity/2026-07-21.html:14-18`)가 "개인 계정 소유 저장소는 이 정책의 수집 대상이 아닙니다"라고 명시하고 있음을 file:line과 함께 기록하고, 이 ADR이 설계하는 조직 밖 public repository 수집이 정확히 그 제외 대상을 수집한다는 상충을 적시했다. `GET /ranking`이 인증 guard 없는 공개 endpoint이고 `RankingService`가 실명을 우선 노출한다는 점(`ranking.controller.ts:12,16`, `ranking.service.ts:110-111`)을 근거로 노출 경로를 명시했다. 조직 밖 public repository 수집 활성화(`EXTERNAL_PUBLIC` 행을 만들어내는 코드 도입)는 동의 문서 개정과 `CONSENT_POLICY_VERSION` 상향 이후에만 가능하다는 것을 New constraint로 추가했다 — 근거는 "이미 노출된 뒤 재동의로는 되돌릴 수 없다"이다. 이 게이트는 스키마·discovery client·REST 배선의 **머지**를 막지 않으며 **활성화**만 막는다는 구분을 명시했다(현재 `CollectionDiscoveryClient`는 어느 module에도 provider로 등록돼 있지 않고 `CollectionSyncService.runExternal()`은 어떤 스케줄러도 호출하지 않아 파이프라인이 구조적으로 inert함을 근거로 확인). 기존 동의 항목 문구 개정 대 별도 opt-in 항목 신설 중 어느 쪽을 택할지는 프로그램 운영 정책 판단이므로 이 ADR이 결정하지 않고 미결로 남겼다. 별건으로, 공개 표기를 GitHub nickname으로 단일화하는 정책 결정(`.omc/plans/github-repository-unification.md` §11이 "D3"로 지칭 — 같은 문서 §7의 "D3 | `Repository` 삭제"와는 다른 항목이라 식별자 중복에 유의)이 아직 구현되지 않았고, 구현되면 실명 우선 노출 문제가 동의 문서 개정과 별개로 완화된다는 사실을 기록했다. D3 구현 자체는 이 ADR 개정의 범위가 아니다. ADR-003 DEC-42는 이 변경과 무관하다.
- 2026-08-04: `apps/backend/src/collection/AGENTS.md` Purpose 문단의 "webhook·OAuth·PAT 수집 경로는 C2(#151, ADR-006)로 제거되었다"는 서술과, 위에서 도입한 조직 밖 public repository 수집용 서비스 계정 PAT가 같은 ADR 안에서 상충하는 것처럼 읽힐 수 있다는 지적에 따라 "선택한 자격증명" 절에 범위 구분 문단을 추가했다. C2의 원문(이 문서 "Alternatives considered"의 "cutover와 rollback" 항목, "C2에서 ... REST complete generation을 유일한 current pointer authority로 전환하고 Collection webhook URL·event subscription·secret을 제거한다", "rollback은 ... webhook credential이나 OAuth/PAT fallback을 되살리지 않는다")을 직접 재확인한 결과, C2가 제거한 것은 **조직(`JNU-SWCU` installation 범위) 저장소를 읽는 Collection App의 current-pointer authority**이지 PAT라는 자격증명 형태 자체의 전면 금지가 아니었다 — `collection/AGENTS.md` Purpose 문단 자신도 그 모듈의 수집 대상을 "조직 설치 범위의 저장소 전체(조직 밖·개인 계정 repo는 제외)"로 명시하고 있어 조직 밖 수집은 애초에 그 문장의 대상 밖이다. 따라서 이번 조직 밖 public repository 수집용 PAT는 C2를 번복(supersede)하는 것이 아니라, C2가 다루지 않은 별도 스코프(조직 밖 수집)의 신규 authority로 판단해 "New constraints"에 이 구분을 명문화했다. 조직 저장소의 current-pointer authority는 여전히 Collection App installation token(REST reconciliation) 하나뿐이며 바뀌지 않았다. `collection/AGENTS.md` Purpose 문단은 이 스코프 구분을 아직 명시하지 않으므로 이 ADR과 함께 갱신돼야 한다는 점을 기록했다 — 다만 그 파일은 `collection` 모듈 소유 레인의 파일이라 이 ADR 편집에서 직접 고치지 않았다.
- 2026-08-04: 위 판정을 ADR 내부 서술만이 아니라 **Issue #151 원문**으로 직접 재확인했다(`gh issue view 151 --comments` 1회 호출, rate limit 절약을 위해 추가 API 호출 없이 진행). #151("백엔드: GitHub 저장소 주기 수집 스케줄러")의 원 범위는 GitHub App 이전의 기존 인증 방식(collection.service.ts/github-api.client.ts, `CollectionRun`/`GithubRawObservation` 기반)으로 조직 저장소를 배치 수집하는 스케줄러화였고 "GitHub App 전환 — #120 소관. 이 티켓은 현재 인증 방식을 그대로 사용한다"고 GitHub App 전환을 명시적으로 범위 밖에 뒀다. 이후 코멘트에서 구현 범위가 GitHub App REST-only 전환까지 확장됐고, 마지막 코멘트가 "Collection App 실설치·REST-only 수집... C1 확인 후 C2 retirement를 진행합니다"라고 C2를 **"retirement"**로 명시했다 — 즉 C2는 조직 저장소를 수집하던 기존 webhook·OAuth·PAT 경로를 퇴역시키고 Collection App installation token REST-only로 일원화한 결정이며, 조직 밖·개인 계정 public repository 수집이라는 개념 자체가 #151에 존재하지 않았다(그 개념은 이후 `.omc/plans/github-repository-unification.md`에서 나왔다). 이 근거와 ADR 자체의 "Collection App의 유일한 수집 authority는 ... webhook, OAuth, PAT 경로를 병행하거나 fallback으로 사용하지 않는다"(주어가 "Collection App"으로 명시) 및 "조직 밖 repository와 개인 계정 소유 repository는 이 범위 밖이다" 문장이 모두 같은 결론을 가리켜 **판정을 1번(범위 명확화)으로 확정**했다 — 2번(전면 supersede)이 아니다. 이어서 "저장·폐기 field inventory"와 "공개 노출과 complete/partial inventory" 두 절이 `source` 값과 무관하게 `EXTERNAL_PUBLIC` 행에도 동일하게 적용된다는 점을 각 절에 명시적으로 추가했다 — forbidden field 목록도, 공개 노출 fail-closed·partial inventory 규칙도 PAT 도입으로 완화되거나 확장되지 않는다. PAT 값 자체(예시 문자열 포함)는 이 개정에도, 다른 어떤 개정에도 등장시키지 않았다 — 시크릿은 gitignore된 저장소에만 존재해야 한다는 제약을 그대로 지켰다.
