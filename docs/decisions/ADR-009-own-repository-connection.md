---
slug: ADR-009-own-repository-connection
date: 2026-08-05
author: GoBeromsu
status: Accepted
references:
  - ADR-006
refines:
  - ADR-006
---

# ADR-009: 학생 소유 저장소 연결(OWN)의 권한·수집 경계

## Status

Proposed

## Date

2026-08-05

## Context

신청 폼에는 저장소 연결 방식이 두 가지 있다.

- `NEW` — 승인되면 `JNU-SWCU` 조직에 저장소를 자동 생성하고 학생을 초대한다. **구현돼 있다.**
- `OWN` — 진행 중인 프로젝트가 있으면 그 저장소를 그대로 프로그램에 연결한다. **값 저장까지만 돼 있고 연결 경로가 없다.**

`repositoryConnectionMode`(enum `NEW|OWN`)와 `repositoryUrl`은 `Application`에 저장되고 승인 시 outbox 프로비저닝 이벤트 payload까지 전달된다. 그런데 워커는 여전히 조직 안에 새 저장소를 만든다. `OWN` URL은 파싱되지만 쓰이지 않는다.

배선을 빠뜨린 게 아니다. **ADR-006에 조직 밖 authority가 없다.**

- ADR-006은 "repository의 기술적 owner는 `JNU-SWCU` Organization이다"를 **Accepted**로 확정했다
- 설치 범위 절과 endpoint·최소 권한 표에 조직 밖 저장소에 대한 write endpoint가 없다
- installation token은 installation 범위 밖 저장소에 **구조적으로** 접근할 수 없다
- 두 token provider와 클라이언트 경로가 모두 org에 하드코딩돼 있다(`/repos/{org}/{name}`, `/orgs/{org}/repos`)

코드가 먼저 authority를 만들어 쓸 수는 없다. 그래서 결정을 요청한다.

### 이 플랫폼이 재는 것은 "학생의 기여"다

결정의 축이 여기서 갈린다. 우리가 만들려는 것은 **학생 개인의 오픈소스 기여 기록**이지 임의 저장소의 활동 대시보드가 아니다. 이 전제를 놓치면 아래 4번이 "표시를 어떻게 할까"라는 화면 문제로 잘못 축소된다. 실제로는 **무엇을 수집할 것인가**의 문제다.

## Decision

### 1. 조직 밖 authority — **read-only로 못박는다**

| 선택지 | 얻는 것 | 잃는 것 |
| --- | --- | --- |
| **1-A. read-only (제안)** | 추가 설치 절차가 없다. 권한 경계가 그대로 남는다 | 저장소 공개 전환·협업자 초대를 `OWN`에서 쓸 수 없다 |
| 1-B. 학생 개인 계정 App installation | `NEW`와 같은 기능 | 학생 개인 계정에 `Administration: write` App을 설치시키는 **새 권한 경계**. 설치 안내·철회 처리·권한 최소화 재설계가 따라온다 |
| 1-C. `OWN` 폐기 | 권한 경계 단순 | 진행 중인 프로젝트를 가진 학생이 참여할 방법이 없어진다 |

**1-A를 택한다.** `OWN`에서 필요한 것은 "이 저장소에서의 내 활동을 집계"이지 저장소를 대신 관리하는 것이 아니다. 1-B는 필요가 증명된 뒤 별도 ADR로 다룬다.

따라서 `OWN` 저장소에는 공개 전환·협업자 초대 기능을 **노출하지 않는다.** UI가 그 차이를 학생에게 설명해야 한다.

### 2. 소유권 검증 — **가볍게 간다**

당초 우려는 "남의 유명 저장소를 붙여 그 실적을 가로챈다"였다. 그런데 4번의 수집 필터를 적용하면 **기여가 0인 사람은 실적도 0**이다. 남의 저장소를 붙여도 얻는 게 없으므로 부정의 동기가 사라진다.

- 신청 시점에 URL 형식과 **저장소의 공개 접근 가능 여부**만 확인한다.
- owner 계정 일치를 강제하지 **않는다.** 정당한 케이스(조직 저장소에 컨트리뷰터로 참여 중)를 막지 않기 위해서다.
- 마일스톤 산출물로 릴리스를 제출하는 경로는 별개 축이다. 그쪽은 제출물 검토(`submission-reviews`)가 사람 판단으로 거른다.

### 3. 외부 활동을 프로그램 실적으로 — **센다**

세지 않으면 `OWN`을 쓸 이유가 없다. 다만 `Repository.source` 구분은 **유지**해 조직 저장소와 외부 저장소를 데이터에서 구별할 수 있게 둔다.

### 4. 제3자 기여자 — **쿼리에서 좁힌다**

여기가 이 ADR의 핵심이다.

현재 수집은 REST로 저장소를 통째로 훑는다.

```
/repos/{owner}/{repo}/commits?sha={branch}&per_page=100   ← author 필터 없음
/repos/{owner}/{repo}/pulls?state=all&per_page=100
/repos/{owner}/{repo}/releases?per_page=100
```

- `CollectionCommitFact` / `PullRequestFact` / `ReleaseFact`가 `authorGithubId`·`authorGithubLogin`을 그대로 적재한다
- `CollectionContributorYearAggregate`는 fact에 나타난 **모든 계정**에 연도별 row를 만든다
- 공개 랭킹 질의는 `repository.visibility = PUBLIC`만 걸고 가입 여부를 보지 않는다

조직 저장소만 붙을 때는 무해했다 — 거기 사람은 정의상 전부 참여자다. **외부 저장소를 붙이는 순간 성질이 바뀐다.** 우리 플랫폼의 존재조차 모르는 사람들의 활동 프로필을 우리 DB에 쌓게 된다. 랭킹 표시 필터로는 못 막는다. 화면에서 감춰도 데이터는 이미 우리 쪽에 있다.

**해법은 필터를 우리가 짜는 게 아니라, GitHub이 애초에 안 보내게 하는 것이다.** GraphQL `history`는 `author` 인자를 받는다.

```graphql
repository(owner:$owner, name:$name) {
  ref(qualifiedName:$branch) {
    target { ... on Commit {
      history(author:{id:$authorId}, since:$since, first:100) { ... }
    }}
  }
  pullRequests(states:[OPEN,MERGED,CLOSED], first:100, orderBy:{field:CREATED_AT, direction:DESC}) { ... }
  releases(first:100, orderBy:{field:CREATED_AT, direction:DESC}) { ... }
}
```

#### 실측 (2026-08-05, 무료 티어 개인 토큰)

| 대상 | 커밋 총수 | author 필터 결과 | GraphQL cost | REST 등가 요청 |
| --- | --- | --- | --- | --- |
| `facebook/react` | 21,620 | 0 (미기여) | **1점** | 약 217회 |
| `JNU-SWCU/oss-hub` | 1,377 | 940 (본인) | **1점** | 약 14회 |
| 위 + PR 100 + 릴리스 100 동시 | — | — | **1점** | 약 20회 |

- 필터가 실제로 동작한다 — 반환된 노드의 author가 전부 지정 계정이다.
- GraphQL은 요청 수가 아니라 **노드 수로 과금**한다. 시간당 5,000점이므로 이 형태로는 **시간당 약 5,000 저장소 동기화**가 가능하다.
- 무료 티어에서 유의미한 여유다. 유료 전환 없이 간다.

#### 축별 결론

지표 모델이 **멤버 활동 → 합치면 팀 활동 → 합치면 프로그램 활동**이다. 원자 단위가 멤버 활동 하나뿐이므로 "저장소 전체 활동"이라는 개념이 필요 없다.

그리고 `TeamMember.userId`가 `User` FK를 강제하므로 **팀원은 정의상 전부 가입자다.** 따라서 author-scoped로 걸러도 팀 활동은 하나도 잃지 않는다. 조직 저장소에 커밋한 미가입자는 팀원이 아니고, 팀원이 아니면 애초에 팀 활동이 아니다.

**1. 팀원 — 개인 단위로 적재한다.** 저장소마다 그 팀의 멤버만 쿼리한다. 플랫폼 전체 사용자가 아니라 **이 팀 사람들**이므로 보통 1~5쿼리다.

**2. 외부 기여자 — 수치만 남긴다.** 「외부 기여자 N명 · 커밋 M개」. 개인 식별자(login·githubId)는 저장하지 않는다. 협업 맥락은 살리되 비동의자 프로파일은 만들지 않는다.

외부 기여자를 "예비 가입자"로 미리 적재하는 안을 검토했으나 폐기했다. `history(author:)`가 `since` 없이 전체 이력을 1점에 가져오므로 **가입·합류 시점 백필로 같은 편의가 나온다.** 미리 쌓으면 이득은 그대로인데 저장 규모가 저장소 인기도에 비례하고(인기 OSS는 기여자 수천 명), 전남대 공식 플랫폼이 비동의자를 "예비 가입자"로 분류·보관하는 리스크가 얹힌다. 공개 데이터라는 것과 기관이 수집·보관·분류하는 것은 다른 행위다.

**3. 조직·외부를 구분하지 않는다.** 규칙이 하나다. 위험의 성질이 달라 보이지만 팀원 단위로 좁히면 양쪽 모두 잃는 것이 없다.

**4. 과거 기여는 보존한다.** 팀에서 빠져도 기존 fact를 지우지 않는다. `User` row를 삭제하지 않는 정책이므로 과거 fact의 `githubId`가 계속 이름으로 풀린다. 기여는 사실이고 나갔다고 안 한 일이 되지 않는다.

**PR·릴리스는 적재 시 거른다.** GraphQL에도 `author` 인자가 없다. `search(query:"repo:X is:pr author:Y")`는 **분당 30회**의 별도 한도라 오히려 위험하므로 쓰지 않는다. PR·릴리스는 저장소당 수백 개 규모라 전량 받아도 커밋(수만 개)과 비용 차원이 다르다.

**저장소 전체 지표는 만들지 않는다.** 총계를 노출하려면 제3자 데이터를 보관해야 하는데 그것이 바로 이 조항이 막으려는 것이다. 외부 기여 규모가 필요하면 2번의 수치로 답한다.

#### 추적 범위는 default branch 하나

수집은 `defaultBranch` 하나만 본다(`collection-sync.service.ts`). 제약이 아니라 이 설계를 성립시키는 조건이다.

오픈소스에서 기여의 단위는 **머지된 PR**이고, 머지되면 커밋이 default branch에 올라간다 — squash든 merge commit이든 author가 보존되므로 `history(author:)`가 잡는다. 머지되지 않은 브랜치 작업은 애초에 실적으로 세기 어렵다.

더 중요한 것은 **뺄셈의 기준이 하나라는 점**이다.

```
전체   = countDefaultBranchCommits(defaultBranch)
팀원합 = 팀원별 history(author:) on defaultBranch
외부   = 전체 − 팀원합
```

총계는 전 브랜치인데 팀원합만 default branch였다면 외부 수치가 부풀려진다. 양쪽에 같은 `defaultBranch`를 넘기므로 그 어긋남이 없다.

`defaultBranch`가 `null`인 빈 저장소는 수집을 건너뛰고 frontier를 건드리지 않아, 첫 커밋이 생긴 뒤 백필된다.

#### 백필 시점

가입만으로는 어느 저장소를 볼지 모른다. 저장소가 특정되는 순간이 트리거다.

| 사건 | 동작 |
| --- | --- |
| 가입 | 없음 — 저장소 미상 |
| 팀 합류·신청 승인 | 다음 sweep에서 그 멤버의 **전체 이력**이 채워진다(별도 트리거 불필요 — 아래) |
| `OWN` 연결 | 그 저장소에서 본인 **전체 이력**을 1쿼리로 채운다 |

`since`를 붙이지 않으므로 **가입 이후 활동만 쌓이는 것이 아니라 과거까지 한 번에 채워진다.** cost 1점이므로 소급이 저렴하다.

**별도 트리거는 두지 않는다.** `collection-sync.service.ts`가 매 sweep에서 팀원 목록을 다시 읽고 팀원별로 `since` 없는 전체 이력을 받으므로, 새 팀원은 다음 sweep에서 자동으로 채워진다. 중복은 `@@unique([repositoryId, sha])`가 막는다. 증분을 쓰지 않는 이유도 같다 — 전체 이력도 1점이라 증분의 이득이 없고, 상태를 덜 들고 가는 쪽이 버그가 적다.

지연은 sweep 주기와 같다(기본 1시간, `COLLECTION_CRON_EXPRESSION`으로 조정).

#### 이미 있는 자산

`collection-discovery.client.ts`가 user-side `contributionsCollection` GraphQL을 **이미 구현해 뒀다.** 주석에 REST로 왜 안 되는지(`/search/commits`는 기본 브랜치만·분당 30회, `/users/{u}/events/public`은 30일 보존)까지 적혀 있다.

따라서 `OWN` 연결은 새 클라이언트가 필요 없다.

```
학생이 OWN URL 연결
  → discovery client로 그 학생이 기여한 저장소 목록 조회
  → 목록에 있으면 연결 승인            ← 2번의 소유권 검증이 여기서 해결된다
  → 이후 동기화는 author-scoped 쿼리로 그 학생 활동만
```

**2번(소유권 검증)이 공짜로 닫힌다.** "이 학생이 실제로 기여한 저장소인가"를 GitHub이 답해 주므로 우리가 owner 일치를 강제할 필요가 없다.

#### 알려진 한계

`history(author:)`는 커밋 author 기준이라 rebase·squash로 committer만 학생인 경우를 놓친다. 그러나 그런 커밋은 GitHub도 그 학생의 기여로 세지 않는다. **GitHub 기준을 그대로 따르는 것이 일관성 있다.**

## Consequences

Accepted가 되면 구현이 따라온다.

- **커밋 수집을 GraphQL author-scoped로 전환** — 기존 REST 전량 페이징을 대체한다. `collection-app.client.ts`의 커밋 경로가 대상이며 PR·릴리스 경로는 유지하되 적재 시 멤버 필터를 건다.
- **취득 경로 선택 로직** — 멤버 수와 커밋 수로 per-author와 전량 중 싼 쪽을 고른다. 판단이 어려우면 외부 저장소는 per-author 고정으로 시작한다.
- **신규 가입자 소급 수집 여부** — 가입 이전 활동은 비어 있다. 가입 시점 이후만 잡을지 소급 재수집할지 판단해야 한다. author-scoped 쿼리는 `since` 없이 던지면 전체 이력을 1점에 가져올 수 있으므로 소급이 저렴하다.
- `Repository`에 연결 방식 필드를 추가해 **"생성하지 않고 연결됨"** 상태를 표현해야 한다. 현재 스키마로는 구별할 수 없다.
- 승인 되돌리기 잠금 조건을 `NEW`로 한정해야 한다. `OWN`은 만들 저장소가 없으므로 프로비저닝 완료 개념이 다르다.
- `GET /repositories/me`의 `https://github.com/JNU-SWCU/{name}` URL 불변식이 외부 URL에서 목록 전체를 예외로 실패시킨다. 연결 방식 분기가 같은 PR에 들어가야 한다.
- 랭킹·공개 프로젝트 지표의 의미가 "저장소 활동"에서 "멤버 기여"로 바뀐다. 조직 저장소에서는 값이 사실상 같아야 하며, 다르면 조사 대상이다.

거부되면 `OWN` 선택지를 신청 폼에서 제거하고, 이미 저장된 `repositoryConnectionMode`·`repositoryUrl` 컬럼의 처리를 별도로 결정한다.

## Alternatives considered

**프로비저닝 계층을 확장해 외부 저장소를 attach한다.** installation token이 범위 밖 저장소에 구조적으로 접근할 수 없어 성립하지 않는다. 학생 개인 계정 installation이 선행돼야 하고 그건 1-B와 같은 결정이다.

**추적 계층(`collection-external-discovery`)에만 위임한다.** 외부 저장소 추적 자체는 이미 있다. 그러나 추적 계층에는 신청(`Application`)을 연결할 경로가 없어 "이 저장소가 이 프로그램의 산출물"이라는 관계를 기록할 수 없다.

**제3자를 적재하되 표시에서만 거른다.** 구현은 더 쉽지만 제3자 활동 데이터가 우리 DB에 남는다. 표시 규칙은 언제든 바뀌고 그때 데이터는 이미 거기 있다. 수집에서 자르는 쪽이 되돌리기 어려운 실수를 막는다.

## Follow-ups

`OWN` 연결 경로와 수집 경계는 구현·병합됐다([#669](https://github.com/JNU-SWCU/oss-hub/pull/669) · [#670](https://github.com/JNU-SWCU/oss-hub/pull/670) · [#671](https://github.com/JNU-SWCU/oss-hub/pull/671) · [#674](https://github.com/JNU-SWCU/oss-hub/pull/674)). 합류 시점 백필은 sweep이 이미 처리하므로 별도 작업이 없다.

남은 것:

- ADR-006의 "기술적 owner = Organization" 조항에 `OWN` 예외(read-only 연결)를 명시하는 갱신.
- 외부 기여자 수치(`전체 − 팀원합`)의 **저장 위치가 미정**이다. 현재는 구해서 로그로만 남긴다. 화면에 노출할 자리가 정해지면 그때 컬럼을 만든다 — 쓰이지 않는 컬럼을 추측으로 먼저 만들지 않는다.

### 구현하며 바뀐 것

**"`Repository`에 연결 방식 필드를 추가한다"는 하지 않았다.** `Application.repositoryConnectionMode`가 이미 있고 `Repository.applicationId`가 `@unique`라 조인 하나로 판정된다. 마이그레이션을 늘리지 않는 쪽이 배포가 단순하다.
