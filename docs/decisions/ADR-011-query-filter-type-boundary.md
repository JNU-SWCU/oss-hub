---
slug: ADR-011-query-filter-type-boundary
date: 2026-08-20
author: GoBeromsu
status: Accepted
references:
  - ADR-003-backend-architecture
  - ADR-004-REST-API-규격
  - ADR-010-contribution-tracking-context
refines:
  - ADR-010-contribution-tracking-context
---

# ADR-011: 질의 필터의 타입 경계 — sentinel 문자열을 SQL 값으로 보내지 않는다

## Status

Accepted

## Date

2026-08-20

## Context

`GET /ranking`과 `GET /dashboard/staff/insights`는 둘 다 HTTP에서 `?year=`를 받는다.
쿼리 문자열은 언제나 문자열이라 `all`과 `2026`이 같은 칸에 들어온다.
랭킹 도메인은 이미 `RankingYear = number | "all"`로 그 둘을 한 타입에 두고, 포트에는 `currentYear?: number`만 넘긴다 — 전체 기간은 필드를 생략한다(`ranking.service.ts`의 `getPublicRankingMetrics`, `public-ranking.repository.ts`의 `yearBounds`).
학생 활성 화면을 만들 때 같은 `?year=`를 쓰면서, 그 문자열을 SQL·Prisma `where`까지 그대로 들고 갈 유혹이 생겼다.
질문은 단순했다. **`"2026"`과 `"all"`을 같은 문자열로 섞어 질의에 넣는 것이 실제로 위험한가.**

이 문서는 그 판정과, 2026-08-20에 고정한 타입 경계를 기록한다.
랭킹의 **기본 연도(부재 시 올해)** 는 계속 [ADR-010](ADR-010-contribution-tracking-context.md) §1이 원본이다.
이 ADR은 기본값이 아니라 **값이 영속 계층에 어떤 타입으로 도착하는가**만 정한다.

## Verdict — 지금 경로에서 `"all"`은 주입 페이로드가 아니다

현재 공개 랭킹 읽기는 Prisma `findMany`와 `date: { gte, lt }`다.
`currentYear`가 있으면 정수로 Asia/Seoul 연도 경계를 만들고, 없으면 기간 조건을 넣지 않는다.
사용자 문자열이 SQL 텍스트에 이어 붙지 않는다.
따라서 **오늘 배포된 랭킹·insights 경로에서 `"all"`을 보내는 것만으로 테이블이 덤프되거나 술어가 뒤집히지는 않는다.**

위험한 것은 `"all"` 토큰 자체가 아니라, 필터 도메인을 문자열로 남겨 다음 수정이 그 문자열을 질의에 잇게 만드는 형태다.
아래는 그 주장을 1차 자료로 맞춘 것이다.

| 실패 모드 | 실제로 일어나는 일 | 주입(CWE-89)인가 |
| --- | --- | --- |
| Prisma tagged `$queryRaw` / `findMany`에 값이 바인딩된다 | 엔진이 SQL과 데이터를 분리한다. `'all'`이 integer/date 칸에 가면 타입이 거절된다 | 아니오 |
| 바인딩된 `'all'`이 integer 칸에 들어간다 | PostgreSQL `22P02` `invalid_text_representation` — `"all"`은 integer가 아니다 | 아니오. 가용성·500 |
| 따옴표 없이 `${year}`를 이어 붙여 `year = all`이 된다 | `ALL`은 SQL 예약어·정량 비교(`expression operator ALL (...)`)다. 구문 오류이거나 의도하지 않은 `ALL` 의미 | 단독으로는 덤프가 아니다. 질의 의도가 바뀌는 입구다 |
| HTTP 원문(`2026 OR 1=1`, `2026';--`)이 `$queryRawUnsafe` 문자열에 이어 붙는다 | 데이터가 명령이 된다 | **예. 이것이 CWE-89다** |
| `$queryRaw(\`... ${user}\`)`처럼 tagged template이 아닌 함수 호출로 문자열을 만든다 | Prisma도 이 쓰임을 주입으로 본다 | 예 |

근거는 아래에 링크로 둔다.
요약하면, **검증을 통과한 숫자만 넘기고 전체 기간은 필드를 빼는 지금 포트 계약은 안전하다.**
위험한 설계는 `year: string` 또는 `number | "all"`을 영속 경계까지 살아 있게 두는 것이다.

## Decision

1. **HTTP는 문자열로 받아도 된다.** `?year=`의 와이어 값은 `all` · 네 자리 연도 · 공백/부재다. ADR-004대로 부분집합은 query parameter다.
2. **컨트롤러·파서가 끝나는 순간 타입을 가른다.** 애플리케이션이 들고 다니는 값은 `{ kind: "all" } | { kind: "calendar"; year: number }`이거나, 포트가 이미 쓰는 `currentYear?: number`(전체는 생략)다. `"all"`과 `"2026"`을 같은 `string`으로 아래로 보내지 않는다.
3. **영속·포트는 숫자를 받거나 조건을 생략한다.** `COLLECTION_READ_PORT.getPublicRankingMetrics`의 `currentYear?: number`가 그 계약이다. `"all"` 토큰, 연도 문자열, `year: number | "all"`을 Prisma `where`나 raw SQL 값으로 넣지 않는다.
4. **raw SQL은 tagged `$queryRaw` / `Prisma.sql`만 기본으로 한다.** `$queryRawUnsafe`는 컴파일 타임 SQL + `$1` 바인딩만 허용한다. 사용자 문자열을 SQL 텍스트에 잇지 않는다. 테이블·컬럼 이름은 파라미터로 바인딩할 수 없으므로 사용자 입력을 식별자에 쓰지 않고 allowlist + `Prisma.raw`만 쓴다.
5. **같은 파라미터 이름이 같은 기본값을 약속하지 않는다.** 랭킹의 `year` 부재는 올해(ADR-010 §1)다. 학생 활성의 `year` 부재·공백·`all`은 전체 기간이다. 기본값은 엔드포인트 계약이고, 형제는 베끼지 않는다.

학생 활성의 원본 구현은 `staff-insights-year.ts`의 `parseInsightsYearQuery` · `rankingYearFilter`다.

## 오늘의 안티패턴 (2026-08-20)

ADR-007이 fallback 위조의 안티패턴을 고정한 것처럼, 이날 막은 두 형태를 이름으로 남긴다.
나중에 같은 모양이 보이면 이 절을 인용한다.

### AP-2026-08-20-1 — Sentinel string as a value

**금지.** 필터를 `type Year = number | "all"` 또는 `year: string`으로 영속 계층까지 들고 가서 `WHERE year = ${year}` / `$queryRawUnsafe(\`... ${year}\`)`의 재료로 쓰는 것.

왜 위험한가.
- HTTP 원문이 파서를 한 번만 건너뛰면 CWE-89의 정의 그대로다 — 외부 입력이 SQL 명령의 일부가 된다.
- `"all"`은 값처럼 보이지만 PostgreSQL에서는 `ALL` 키워드다. 따옴표 없이 이어 붙이면 데이터가 아니라 문법으로 읽힌다.
- 바인딩되더라도 integer/date 칸에 `"all"`은 `22P02`로 터질 뿐이고, 그때 화면은 "전체 기간"이 아니라 500을 본다.

**올바른 설계.** 파서가 discriminated union으로 갈라, 전체 기간은 조건을 생략하고 연도는 `number`만 포트에 넘긴다.
랭킹이 이미 포트 호출에서 이렇게 하고, insights는 타입부터 이렇게 시작한다.

### AP-2026-08-20-2 — Same query name, same default

**금지.** 공개 랭킹이 `?year=` 부재를 올해로 읽으니(ADR-010 §1) 교직원 활성도 그렇게 맞추는 것.

왜 틀린가.
- 같은 이름이지 같은 질문이 아니다. 랭킹은 "올해 내가 얼마나 했나"이고, 활성은 "가입 학과별로 쌓인 기여와 참여를 한눈에"다.
- 기본값을 형제가 상속하면, 사이드바가 `all`을 가리키는데 본문은 올해를 보여주는 어긋남이 다시 난다 — 랭킹 셸에서 이미 관측된 종류다.

**올바른 설계.** 부재 시 기본값은 그 화면의 한 줄 계약으로 파서에 적고, 테스트가 부재·`""`·`all`·`YYYY`를 각각 고정한다.
insights는 부재=`all`이며 전체 기간 URL에는 `?year=`를 붙이지 않아 서버 기본과 주소가 같다.

## Alternatives considered

### `number | "all"`을 저장소 끝까지 허용한다

- Pros: 랭킹 도메인 타입을 그대로 재사용한다.
- Cons: `"all"`이 값처럼 보여 다음 수정이 보간에 넣기 쉽다. 포트 타입이 `number`인데 호출부가 문자열을 강제 변환하면 컴파일 타임 보호가 사라진다.
- **Rejected:** 편의는 파서에 두고, 영속 경계에는 숫자 또는 생략만 남긴다.

### SQL에서 `year IN ('all', $1)`처럼 문자열로 비교한다

- Pros: 한 질의로 전체와 연도를 표현할 수 있다고 착각하기 쉽다.
- Cons: 연도 컬럼은 integer/date다. `'all'`은 비교 대상이 아니라 분기 토큰이다. 분기 토큰을 행 값과 같은 `IN` 목록에 넣으면 타입 오류이거나, 텍스트 컬럼으로 내리는 순간 주입 표면이 열린다.
- **Rejected:** 전체 기간은 `WHERE`를 만들지 않는 분기다.

### 입력 검증만 하고 타입은 문자열로 둔다

- Pros: 정규식 allowlist(OWASP Option 3)만으로도 많은 페이로드를 막는다.
- Cons: allowlist는 보조다. 검증을 통과한 뒤에도 타입이 `string`이면 raw SQL 보간의 재료가 된다. OWASP 1순위는 파라미터 바인딩이지 정규식 단독이 아니다.
- **Rejected:** allowlist는 파서에서 하고, 그 아래는 타입이 막는다.

## Consequences

### Enables

- 학생 활성·랭킹·앞으로의 연도 필터가 같은 영속 계약을 쓴다 — 숫자 또는 생략.
- `"all"`이 SQL 예약어라는 사실이 코드 리뷰 상식이 아니라 이 문서의 판정이다.
- 기본값 불일치를 보안 이슈와 섞지 않는다. 기본값은 제품 계약, 타입 경계는 이 ADR이다.

### Costs / trade-offs

- HTTP DTO의 `year?: string`과 애플리케이션 스코프 타입이 한 단계 더 있다.
- 랭킹 도메인의 `RankingYear = number | "all"`은 캐시 키·응답 봉투용으로 남을 수 있다. 포트에 `"all"`을 넣지만 않으면 이 ADR을 깨지 않는다. 도메인 타입을 union으로 옮기는 것은 필수 후속이 아니다.

### New constraints

- 새 `?year=`(또는 동등한 기간 필터)는 파서에서 스코프를 가르고, 테스트가 부재 기본값과 거부 문자열(`2026;…` 같은 혼합)을 고정한다.
- `$queryRawUnsafe`에 사용자 입력을 이어 붙이는 PR은 이 ADR 위반이다. 정적 SQL + 바인딩은 기존 canonical 경로처럼 허용한다.
- 활성 분류의 학과 원본은 가입 프로필(`UserProfile.department` / legacy `User.department`)이다. 공개 랭킹이 같은 칸을 내려 주는 것(ADR-010 D15 개정)과 별개로, insights는 랭킹 행이 없는 학생도 세기 위해 그 프로필을 직접 읽는다. 실명은 묻지 않는다(`includeRealName` 생략).

## References

1차 자료만 적는다. 블로그 요약은 근거로 쓰지 않는다.

- [CWE-89: Improper Neutralization of Special Elements used in an SQL Command](https://cwe.mitre.org/data/definitions/89.html) — 외부 입력이 SQL 명령의 일부가 되는 약점의 정의. 이 ADR이 막는 것은 이 약점의 **입구**(문자열 필터가 보간에 닿는 형태)다.
- [OWASP SQL Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html) — 1순위는 prepared statement / parameterized query. 입력 allowlist는 3순위 보조다. escaping은 권고하지 않는다.
- [Prisma: Raw queries](https://www.prisma.io/docs/orm/prisma-client/using-raw-sql/raw-queries) — `$queryRaw` tagged template은 파라미터 바인딩. `$queryRawUnsafe`는 이어 붙이면 주입 위험이 있다고 문서가 명시한다. 식별자(테이블·컬럼)는 `$queryRaw`로 보간할 수 없다.
- [Prisma Discussion #20132](https://github.com/prisma/prisma/discussions/20132) — `$queryRaw\`… ${x}\``, `Prisma.sql`, `$queryRawUnsafe('… $1', x)`는 안전하고, `` $queryRawUnsafe(`… ${x}`) ``는 안전하지 않다고 메인테이너가 가른다.
- [PostgreSQL 9.25 Row and Array Comparisons — ALL](https://www.postgresql.org/docs/current/functions-comparisons.html#FUNCTIONS-COMPARISONS-ALL) — `ALL`은 `expression operator ALL (array|subquery)` 정량 비교 키워드다. 값 `"all"`을 따옴표 없이 이어 붙이면 이 문법과 충돌한다.
- [PostgreSQL Appendix: SQL Key Words](https://www.postgresql.org/docs/current/sql-keywords-appendix.html) — `ALL` reserved.
- [PostgreSQL Appendix: Error Codes — `22P02`](https://www.postgresql.org/docs/current/errcodes-appendix.html) — `invalid_text_representation`. integer/date가 아닌 텍스트(`all`)를 그 타입으로 읽으면 이 코드로 거절한다. 주입이 아니라 타입 오류다.

## Changelog

- 2026-08-20: 신규. 질의 필터의 영속 타입 경계와 2026-08-20 안티패턴 두 개를 고정한다. 랭킹 기본 연도(부재=올해)는 ADR-010 §1을 유지하고, 학생 활성 기본(부재=전체)은 이 문서 §Decision 5다.
- 2026-08-20: 공개 랭킹이 `department`를 내리도록 개정된 뒤(ADR-010 D15), insights는 그 칸을 분류 원본으로 쓰지 않고 가입 프로필을 직접 읽는다는 제약을 정정했다. 활성 지표는 랭킹 5종(commit·PR·issue·repo·star)과 같은 합이다.
