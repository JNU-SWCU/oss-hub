---
slug: ADR-009-own-repository-connection
date: 2026-08-05
author: GoBeromsu
status: Proposed
references:
  - ADR-006
refines:
  - ADR-006
---

# ADR-009: 학생 소유 저장소 연결(OWN)의 권한 경계

## Status

Proposed

이 문서는 **결정 요청**이다. 아래 네 항목이 확정되기 전까지 `OWN` 연결은 구현하지 않는다.

## Date

2026-08-05

## Context

신청 폼에는 저장소 연결 방식이 두 가지 있다.

- `NEW` — 승인되면 `JNU-SWCU` 조직에 저장소를 자동 생성하고 학생을 초대한다. **구현돼 있다.**
- `OWN` — 진행 중인 프로젝트가 있으면 그 저장소를 그대로 프로그램에 연결한다. **값 저장까지만 돼 있고 연결 경로가 없다.**

`repositoryConnectionMode`(enum `NEW|OWN`)와 `repositoryUrl`은 `Application`에 저장되고 승인 시 outbox 프로비저닝 이벤트 payload까지 전달된다. 그런데 워커는 여전히 조직 안에 새 저장소를 만든다. `OWN` URL은 파싱되지만 쓰이지 않는다.

이유는 배선 누락이 아니다. **ADR-006이 조직 밖 authority를 갖고 있지 않다.**

- ADR-006은 "repository의 기술적 owner는 `JNU-SWCU` Organization이다"를 Accepted로 확정했다.
- 설치 범위 절과 endpoint·최소 권한 표에 조직 밖 저장소에 대한 write endpoint가 없다.
- installation token은 installation 범위 밖 저장소에 **구조적으로** 접근할 수 없다.
- 두 token provider(`github-app.token.ts`, `collection-app.token.ts`)가 모두 org installation을 전제하고, 클라이언트 경로(`github-app.client.ts`)도 `/repos/{org}/{name}`·`/orgs/{org}/repos`로 조직에 하드코딩돼 있다.

코드가 먼저 authority를 만들어 쓸 수는 없다. 그래서 결정을 먼저 요청한다.

## Decision (요청 항목)

### 1. 조직 밖 authority를 어떻게 확보하는가

| 선택지 | 얻는 것 | 잃는 것 |
| --- | --- | --- |
| **1-A. read-only로 못박는다** | 추가 설치 절차가 없다. 활동 수집만 하고 쓰기를 하지 않으므로 권한 경계가 그대로 남는다 | 저장소 공개 전환·협업자 초대·릴리스 검증 같은 write 기능을 `OWN`에서 쓸 수 없다 |
| **1-B. 학생 개인 계정에 App installation을 신설한다** | `NEW`와 같은 기능을 `OWN`에서도 쓸 수 있다 | 학생 개인 계정에 `Administration: write` 권한 App을 설치시키는 **새 권한 경계**가 생긴다. 설치 안내·철회 처리·권한 최소화 재설계가 따라온다 |
| **1-C. `OWN`을 폐기한다** | 권한 경계가 단순해진다 | 이미 진행 중인 프로젝트를 가진 학생이 프로그램에 참여할 방법이 없어진다 |

**권장: 1-A(read-only).** 프로그램이 `OWN`에서 실제로 필요한 것은 "이 저장소의 활동을 내 성과로 집계"이지 저장소를 대신 관리하는 것이 아니다. write까지 열면 얻는 것에 비해 권한 경계가 과하게 넓어진다. 1-B는 필요가 증명된 뒤에 별도 ADR로 다룬다.

### 2. 소유권 검증의 정의와 시점

검증이 없으면 **남의 저장소를 자기 성과로 등록**할 수 있다. 유명 오픈소스 저장소 URL을 넣고 그 릴리스를 마일스톤 산출물로 제출하는 부정이 가능하다.

| 항목 | 선택지 |
| --- | --- |
| 무엇을 소유로 보는가 | (a) 저장소 owner가 학생 GitHub 계정 (b) 학생이 admin 권한 보유 (c) 학생이 collaborator 이상 |
| 언제 검증하는가 | (a) 신청 시점 — 학생이 즉시 오류를 본다 (b) 승인 시점 — 교직원 판정 직전 최신 상태로 본다 (c) 둘 다 |

**권장: (a) owner 일치 + (c) 양쪽 검증.** 신청 시점 검증은 학생 경험을 위해, 승인 시점 재검증은 그 사이 소유권이 바뀌는 경우를 막기 위해 필요하다. 세션에 `User.githubId`가 있으므로 공개 API로 owner를 확인할 수 있다.

### 3. 외부 저장소 활동을 프로그램 실적으로 셀 것인가

현재 프로그램·공개 지표 read 경로는 `source: ORG_PROVISIONED`로 고정돼 외부 저장소를 배제한다.

| 선택지 | 결과 |
| --- | --- |
| **3-A. 센다** | `OWN` 참여자도 랭킹·아카이브에 나타난다. `OWN`의 실질적 이유가 성립한다 |
| **3-B. 세지 않는다** | 조직 저장소만 실적이 된다. `OWN`은 "연결해 두기"에 그치고 학생이 왜 쓰는지 설명하기 어렵다 |

**권장: 3-A.** 다만 `source` 구분은 유지해 조직 저장소와 외부 저장소를 데이터에서 구별할 수 있게 둔다.

### 4. 공개 랭킹의 제3자 기여자 처리

외부 저장소에는 **플랫폼과 무관한 기여자**가 있다. 현재 랭킹에는 기여자 필터가 없고 endpoint는 비인증이다. 3-A를 택하면 외부 저장소의 모든 기여자가 공개 랭킹에 유입된다.

**권장: 플랫폼 사용자 필터.** 집계 대상을 이 플랫폼에 가입한 사용자로 한정한다. 등록되지 않은 GitHub 계정의 활동은 저장소 지표에는 반영하되 개인 랭킹에는 넣지 않는다.

## Consequences

이 ADR이 Accepted가 되면 구현이 따라온다.

- `Repository`에 연결 방식 필드를 추가해 **"생성하지 않고 연결됨"** 상태를 표현해야 한다. 현재 스키마로는 이 상태를 구별할 수 없다.
- 승인 되돌리기 잠금 조건을 `NEW`로 한정해야 한다. `OWN`에서 프로비저닝 job을 `SUCCEEDED`로 기록하면 되돌리기가 영구히 잠긴다.
- `GET /repositories/me`의 `https://github.com/JNU-SWCU/{name}` URL 불변식이 외부 URL에서 목록 전체를 예외로 실패시킨다. 연결 방식 분기가 같은 PR에 들어가야 한다.
- 1-A(read-only)를 택하면 `OWN` 저장소에는 공개 전환·협업자 초대 기능을 노출하지 않아야 한다. UI에서 그 차이를 학생에게 설명해야 한다.

거부되면 `OWN` 선택지를 신청 폼에서 제거하고, 이미 저장된 `repositoryConnectionMode`·`repositoryUrl` 컬럼의 처리를 별도로 결정한다.

## Alternatives considered

**프로비저닝 계층을 확장해 외부 저장소를 attach한다.** installation token이 범위 밖 저장소에 구조적으로 접근할 수 없어 성립하지 않는다. 학생 개인 계정 installation이 선행돼야 하고 그건 1-B와 같은 결정이다.

**추적 계층(`collection-external-discovery`)에만 위임한다.** 외부 저장소 추적 자체는 이미 있다. 그러나 추적 계층에는 신청(`Application`)을 연결할 경로가 없어 "이 저장소가 이 프로그램의 산출물"이라는 관계를 기록할 수 없다. 2·3·4번 결정이 여전히 필요하다.

## Follow-ups

- Accepted 후: 연결 방식 필드 추가 마이그레이션, 소유권 검증 구현, `GET /repositories/me` 분기, 랭킹 기여자 필터.
- ADR-006의 "기술적 owner = Organization" 조항에 `OWN` 예외를 명시하는 갱신.
