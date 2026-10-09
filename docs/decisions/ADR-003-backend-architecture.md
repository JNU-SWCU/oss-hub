---
slug: ADR-003-backend-architecture
date: 2026-07-11
author: GoBeromsu
status: Accepted
references:
  - ADR-001-테크스택
refines: []
---

# ADR-003: Backend Architecture

## Status

Accepted

2026-10-08 개정은 아래 §10의 backend 계층 규약을 승인한 결정이며 전체 코드의 이행 완료를 뜻하지 않는다.
이행 상태와 검증 증거는 [#1478](https://github.com/JNU-SWCU/oss-hub/issues/1478) 및 연결된 PR에서 관리한다.
§10은 이전 DEC-42와 [ADR-010](ADR-010-contribution-tracking-context.md) §7의 주입 키·Port 규칙 및 §8의 폴더 규칙을 대체한다.

> **2026-08-20 amendment — `COLLECTION_READ_PORT` 삭제.** DEC-42가 같은 DB 읽기 앞에 둔 in-process Port는 이 개정으로 폐지한다. 아래 Decision이 현재 결정이다. 폐지 직전 DEC-42 문장은 Changelog 2026-08-20에 그대로 둔다.
>
> **같은 날 후속 — 다른 모듈 Service hop 금지.** `RankingService.findPublicActivity`는 `return this.ranking.findMetrics(query)` 한 줄이었다. Port를 Service로 옮긴 것과 같은 안티패턴이다. staff-insights는 자기 Repository로 읽는다.

## Date

2026-07-11

## Context

NestJS backend는 기능이 늘어나도 관련 코드의 탐색 경로와 의존 방향을 유지해야 한다. API 요청의 유효성 검증, 도메인 오류 변환, 데이터 변경의 트랜잭션 범위를 일관되게 처리할 필요가 있다. 초기 단계에서 추상 계층을 과도하게 늘리면 팀의 구현·리뷰 비용이 실제 복잡도보다 커진다.

DEC-42는 collection 모듈의 같은 DB 조회를 `COLLECTION_READ_PORT` 뒤로 모았다. 실제로 `CollectionReadService.getPublicRankingMetrics`는 `return this.publicRanking.findMetrics(query)` 한 줄 hop이었다. 그 Port는 Fowler Gateway를 프로세스 안 조회 버스로 쓴 것이고, 그 hop은 Service Layer와 겹치는 pass-through였다. 테이블당 Repository(Table Data Gateway / 레거시 DAL)와 쓰기 Repository 규칙으로 조회 JOIN을 막는 관행이 같이 붙어 있었다.

같은 안티패턴이 Port를 지운 뒤 Service에 다시 나타났다. `RankingService.findPublicActivity`는 insights가 부르기 위한 `return this.ranking.findMetrics(query)`였다. Fowler Service Layer는 자기 usecase 경계이지, 다른 화면의 같은-DB 조회 버스가 아니다. 출석부 테이블이 같다고 랭킹 질문을 insights가 빌리는 것은 Table Data Gateway/repository-per-table이다. Microsoft Learn persistence layer가 금지하는 그것이다.

## Decision

backend는 기능 모듈 폴더를 최상위 구성 단위로 사용한다.
모듈 내부는 Controller → Service → Repository의 단방향 Layered 구조다.
Prisma DB 접근은 repository와 `prisma/`에만 두며 열거형 import와 조립·테스트 예외는 §10을 따른다.
Service는 Fowler Service Layer로서 usecase와 트랜잭션(Unit of Work)을 소유하고 HTTP 전송 타입과 Prisma model을 노출하지 않는다.
Controller는 HTTP 입력 검증, request DTO→application DTO 변환, guard/header/status와 response DTO 변환을 담당하고 DB 접근과 업무 규칙을 소유하지 않는다.
Repository는 영속성 접근과 persistence DTO를 담당하고 Prisma row를 계층 밖으로 흘리지 않는다.
DTO와 도메인 모델은 분리한다.

NestJS 전역 예외 필터가 예외를 API 오류 응답으로 변환한다. 모든 데이터 변경 usecase의 트랜잭션 시작·완료·실패 처리는 Service Layer가 소유한다. Controller↔Service와 Service↔Repository 계약은 명시적 DTO를 쓰며 Controller와 Service 사이에 Port를 만들지 않는다. 기능 요구가 없는 포트·어댑터·추가 추상화는 도입하지 않는다. 한 줄 hop은 orchestration이 아니다.

외부 시스템(GitHub HTTP 등)에 대한 호출은 모듈 내부 gateway에 둔다.
같은 DB 접근 앞에 별칭 주입 키나 별도 Port 계층을 만들지 않는다.
모듈 간 유스케이스와 기능 재사용은 §10의 service 경계를 따르되 다른 모듈의 Service를 단순한 같은-DB 조회 버스로 쓰지 않는다.
폐지된 `COLLECTION_READ_PORT`와 `RankingService.findPublicActivity`를 복원하지 않는다.
staff-insights 활성 조회는 `StaffInsightsRepository`가 소유한다.
자기 모듈 Controller가 부르는 `listYears`처럼 계층을 지키는 위임은 hop이 아니다.

읽기 Repository는 테이블이 아니라 화면 질문 하나에 답한다. Fowler Repository는 한 집합의 객체에 대한 컬렉션형 인터페이스이지, 테이블당 하나씩 두는 Table Data Gateway/레거시 DAL이 아니다. Microsoft Learn persistence layer도 repository-per-table을 금지한다. Meyer/Fowler Command Query Separation과 Microsoft Learn CQS/CQRS에서 조회는 JOIN할 수 있다. 쓰기 Repository 규칙을 읽기에 그대로 씌워 조인을 막지 않는다.

`github`는 소비자 모듈을 역import하지 않는다. 소비자 Service는 `github`의 concrete repository를 import하지 않는다. 소비자 Repository는 Prisma를 직접 쓴다.

`GET /ranking`은 전원에게 공개다. STUDENT 세션은 익명과 같다. public entry는 `rank`·`githubLogin`·`commitCount`·`pullRequestCount` 네 필드만 내려간다. 페이지 metadata의 `dataAsOf`·`nextCycleAt`은 공개하지만 `displayName`·`name`·`department`와 issue·repository·star·total 집계는 내리지 않는다. Staff/Admin ACTIVE 세션(`viewerClass` staff)만 rich entry와 CSV를 받는다. 실행 wire 계약의 SSoT은 ranking response DTO와 그 회귀 테스트다.

공개 endpoint의 private 데이터 strict-read는 owner-approved dedicated public query repository에서만 허용한다. 이 repository는 explicit select와 public DTO allowlist를 사용하고 service allowlist, private/nonexistent 동일 404, selector/integration review evidence를 요구한다. Controller와 일반 Service의 Prisma 직접 접근, 임의 private join, wildcard include, redact-later와 forbidden field fetch는 금지한다.

### 10. Backend 계층 규약 개정

#### 10.1 폴더와 import 경계

Domain-first + Layered를 모든 backend 업무 모듈의 목표 구조로 채택한다.
업무 모듈 내부의 계층 폴더는 `controller/ service/ repository/ gateway/ job/ dto/ domain/`으로 닫고 빈 폴더는 만들지 않는다.
중첩된 `programs/archive/<feature>/`도 동일한 계층 규칙을 적용한다.
모듈 루트에는 module 조립, 설정, 주입 키, 오류 코드, 타입 등 명시적으로 분류한 파일과 인접 테스트만 둔다.
모듈 루트 계약 파일은 자기 모듈 루트 계약, domain, runtime-config, prisma 기반 타입만 참조한다.
인증 guard는 controller 계층이며 별도 업무 권한 guard 계층을 만들지 않는다.
`common/`, `runtime-config/`, `prisma/`는 공통 기반 모듈이고 `storage`와 `auth`는 재사용 가능한 기능 모듈이다.
`common/`에는 업무 규칙을 두지 않고 업무별 순수 로직은 소유 모듈의 `domain/`으로 옮긴다.

| 출발 | 허용 대상 |
| --- | --- |
| controller, job | service, dto, domain, auth의 인증 guard·AuthenticatedRequest, common |
| service | 자기 repository·gateway, dto, 모든 모듈의 domain·service, storage, runtime-config, common |
| repository | 자기 모듈 repository, 모든 모듈의 domain, prisma 기반 기능, common |
| gateway | domain, 외부 SDK, common |
| dto | domain, common |
| domain | 다른 모듈을 포함한 domain, common |
| common | common |
| composition, test | 자기 모듈 내부, 다른 모듈의 module 파일·service 및 명시적 테스트 예외 |

표에 없는 계층 의존은 기본 거부하며 모든 계층은 common을 사용할 수 있다.
다른 모듈의 repository·gateway 직접 import는 금지한다.
서비스 간 의존은 유스케이스·정책을 재사용할 때만 허용하며 순환 의존이나 한 줄 조회 중계는 허용하지 않는다.
외부 호출은 gateway, Cron·Interval·CLI 진입은 job, 실행 가능한 업무 동작은 service가 소유한다.
서비스가 job을 호출하거나 job이 repository를 직접 호출하지 않는다.
`*Dto` 선언은 dto에 두고 운영 코드가 테스트·fixture를 import하지 못하게 한다.

#### 10.2 주입 키와 S4·S5 판단

구체 클래스 주입을 기본으로 하고 주입 키는 interface·object·function 경계에만 둔다.
`MAIL_SENDER`, `OBJECT_STORAGE`, `RUNTIME_CONFIG`, clock 같은 경계는 유지하되 클래스에 두 번째 이름만 붙이는 `useExisting` 별칭은 금지한다.
Nest 내장 키 `APP_GUARD`, `APP_FILTER`, `APP_INTERCEPTOR`, `APP_PIPE`는 횡단 기반 기능의 전역 등록에만 예외로 허용한다.
`APP_GUARD`로 등록하는 `AuthenticationGuard`는 이 예외에 속한다.
같은 DB 서비스의 별칭 주입 키는 제거하고 모듈은 좁은 service 클래스를 export한다.
Port는 폴더나 독립 계층이 아니다.

S4 조사에서 `ProgramEditorRepositoryPort`와 `AuditLogRepositoryPort`는 단일 구현의 계약을 중복 기술하는 것으로 판단했다.
이를 구체 클래스에서 유도한 `Pick`·`jest.Mocked` 계약으로 대체하되 generic transaction fixture의 의미를 보존한다.
S5 조사에서는 GitHub client에 상태를 가진 fake와 E2E override가 존재하므로 concrete class DI를 유지하고 새 interface를 도입하지 않기로 했다.
fake의 `revokeCollaborator` 계약 누락은 소유 모듈 이행 시 확인·보완해야 하며 이 결정은 그 보완이나 검증이 완료됐다는 주장이 아니다.
테스트 대역이 있다는 이유만으로 같은 DB의 중복 주입 키나 별도 Port 계층을 유지하지 않는다.

#### 10.3 Prisma 열거형 허용 범위

DB 접근 심볼인 `PrismaClient`, `PrismaService`, transaction client, `Prisma` namespace와 `Prisma.sql`은 repository와 `prisma/`에만 둔다.
업무 계층의 `@prisma/client` import는 스키마에 선언된 열거형 이름만 positive allowlist로 허용한다.
이 허용은 domain에도 적용하며 `Prisma`, model type, `PrismaPromise`, default·namespace import는 허용하지 않는다.
열거형의 alias·type-only import는 허용하되 model의 type-only import는 거부한다.
재export, require, dynamic import로 이 경계를 우회하지 못하게 한다.
module 조립, 테스트·fixture·support, Prisma seed는 명시적으로 분류한 예외이며 일반 service나 guard의 DB 접근 예외가 아니다.

`scripts/prisma-enum-names.mjs`는 `schema.prisma`의 enum 선언을 결정적으로 추출해 `prismaEnumNames`를 export한다.
ESLint 설정을 로드할 때 생성된 client를 runtime 의존성으로 요구하지 않는다.
생성된 client의 `$Enums`와 목록이 일치하는지는 별도 테스트로 검사한다.
이 개정은 enum 값이나 DB schema를 바꾸지 않는다.

#### 10.4 잠금 순서와 S6 결정

트리 잠금의 단일 실행 진입점은 `prisma/lock-program-tree.ts`의 `lockProgramTree(tx, step)`이며 repository와 테스트만 import한다.
개별 Program·Milestone·문서 잠금 helper는 export하지 않는다.
단계는 Program → Milestone → MilestoneDocument 순서이고 문서는 id 오름차순으로 잠근다.
기존에 Program을 잠그지 않는 milestone-only 흐름에는 새 Program 잠금을 추가하지 않는다.
program·milestone 단계는 행이 없으면 null을 반환하고 다음 단계는 앞 단계의 opaque witness로 연결한다.
문서 단계는 `DOCUMENT`와 `ALL`을 구별하고 앞 단계 잠금을 다시 획득하지 않는다.
transaction별 상태와 witness로 반복·역순·다른 transaction의 witness 사용을 거부한다.
단계 사이 조회, programId 일치 검사, null 처리, projection은 호출자가 기존 위치와 의미대로 유지한다.
단일 문서의 repository-local 잠금은 이 트리 helper로 합치지 않는다.

S6에서는 `updateMilestoneEdit`가 같은 transaction에서 같은 트리를 쓰기 전후 두 번 잠그는 경로를 확인했다.
승인된 선택 A는 transaction 내 재잠금 금지를 유지하고 쓰기 뒤 두 번째 `lockMilestoneEdit`를 같은 transaction의 잠금 없는 재조회로 바꾸는 것이다.
이 중복 잠금 SQL의 제거만 승인됐으며 응답 필드, 읽기 순서, null 처리, programId 불일치 동작은 보존한다.
다른 중복 잠금도 같은 원칙으로 처리하되 응답이 달라지면 이행을 중단하고 결정을 다시 받는다.
호출별 SQL 순서·인자·조기 반환과 동시 transaction 동작을 characterization으로 검증하며 타입 witness 검증은 `ts.createProgram`의 semantic diagnostics를 사용한다.

#### 10.5 인증·권한과 S7·S8 결정

S7 결정에 따라 `AuthenticationGuard`와 `SessionGuard`를 모두 유지한다.
전자는 전역 기본 인증 및 public·optional-session 예외를 처리하고 후자는 라우트의 명시적 세션 요구를 처리한다.
둘의 역할이 겹친다는 이유만으로 이번 이행에서 하나를 삭제하지 않는다.
`OriginGuard`의 Origin 검사도 유지한다.

업무 권한 확인은 service가 `UsersAuthorityService`를 통해 수행하며 사용자 조회는 users repository가 소유한다.
`assertActiveStaff`·`assertAdmin`은 호출 모듈의 오류 생성 계약을 받아 기존 module code·메시지·본문을 보존한다.
기존 guard별 active·staff·admin 정책을 임의로 합치지 않는다.
게시판 참여 자격은 board service·repository가 소유하고 staff 판단만 users 권한 서비스를 재사용한다.
이행 대상 권한 guard는 applications-staff, milestone-documents-staff, program-teams-staff, submission-reviews-staff, collection-admin, board-access 여섯 파일이며 applications의 list 전용 subclass도 함께 제거한다.

S8의 board HTTP probe에서 권한 없는 actor의 invalid body·query는 기존 `403 BRD_001`에서 `400 SYS_003`으로, invalid·missing Origin은 `403 BRD_001`에서 `403 AUT_002`로 우선 오류가 바뀌었다.
이는 전체 모듈 검증 완료가 아니라 guard에서 service로 옮길 때 생기는 순서 변화의 근거다.
승인된 선택 B는 guard 삭제를 유지하고 권한 없는 actor의 invalid body·query·params·Origin에 대해 validation 또는 Origin 오류가 업무 권한 오류보다 먼저 발생하는 변화를 수용한다.
유효한 요청의 status, 모듈 오류 코드, 메시지, 응답 본문과 익명 인증 계약은 바꾸지 않는다.
각 권한 이행 PR은 이 우선순위 변화를 명시하고 새 순서 characterization 및 기존 403-first 전제를 가진 backend·E2E·frontend 검사를 함께 갱신한다.
검증을 늦추거나 별도 interceptor로 이전 순서를 위장하지 않는다.

#### 10.6 Storage 기능 경계

`storage`는 `put/get/delete`를 제공하는 공통 기능 모듈이며 `OBJECT_STORAGE`를 concrete adapter의 `useClass`로 연결한다.
object key·파일명 정책은 소유 업무 domain에 두고 storage에 프로그램·제출 업무 규칙을 넣지 않는다.
객체 목록 조회 capability는 업로드·다운로드 API와 구분하고 고아 객체 판정과 DB 참조 조회는 소유 업무 모듈에 둔다.
기존 env key, 오류 문자열, object key 및 CLI 계약은 보존한다.
E2E는 명시적 storage 대역을 사용하며 실제 managed R2로 연결하지 않는다.

#### 10.7 강제 장치와 신뢰 경계

두 앱은 공통 type-aware lint와 no-comments 규칙을 공유하되 각 앱의 runtime·framework 규칙은 유지한다.
backend 계층 경계는 `eslint-plugin-boundaries`, 순환 검사, 열거형 positive allowlist, 주입 키·DTO·테스트 경계 검사로 강제한다.
boundaries 도구의 비호환을 임의 대체 구현으로 숨기지 않는다.
순환 검사는 dpdm 그래프를 lint 진단으로 내보내며 기존 순환은 감소 전용 기준선으로 관리한다.
dpdm이 간선을 수집하지 못하는 type 위치 `import()`·`import x = require()`는 운영 코드에서 금지하고 `@dpdm-ignore` 표식은 어디서도 허용하지 않는다.
해석되지 않은 내부 의존은 순환 없음으로 간주하지 않고 검사 실패로 처리한다.
모듈별 이관 중에는 아직 닫힌 폴더로 옮기지 않은 파일로의 의존을 경계 위반으로 따로 세지 않고 그 대상 파일의 미분류 부채로만 집계한다.
대상 모듈이 이관되면 그 의존은 계층 정책으로 다시 검사되고, 위반이면 대상 모듈 이관 PR이 함께 고친다.
미분류 파일이 남지 않는 P7에서 미분류 대상 검사를 다시 켠다.
CLI 실행 진입점인 job은 앱 부트스트랩과 런타임 설정을 import할 수 있다.
Knip은 명시적 runtime·CLI·seed·test 진입점을 기준으로 사용하지 않는 코드를 탐지한다.
Nest DI나 decorator 때문에 생긴 findings는 근거 있는 entry·설정으로 다루며 광범위한 무시 규칙으로 감추지 않는다.

이행 기간 lint baseline은 줄 번호가 아닌 `{file, ruleId, target}` identity로 관리한다.
파일 전체를 가리키는 진단의 target은 파일 내용이 아니라 파일 자체로 정해 import 경로 수정만으로 기존 부채가 새 항목이 되지 않게 한다.
기존 legacy 모듈 경계 규칙은 §10의 공개 `domain/` 교차 참조와 github 수집 trigger service를 허용한다.
새 diagnostic·shard·항목 추가, 같은 개수 교환, 이동한 경로의 재등록, stale 항목을 거부하고 baseline은 줄어들기만 한다.
Knip은 workspace·issue type별 실제 개수와 budget이 정확히 같아야 하며 head budget은 predecessor budget보다 커질 수 없다.
기준 baseline은 working tree나 가변 ref가 아니라 신뢰된 predecessor SHA의 Git tree에서 읽는다.
PR은 명시한 base·검사 head의 merge-base, main push는 event의 before SHA를 사용한다.
0 SHA, 누락된 Git object, 비선조 before SHA는 실패로 처리하며 현재 main으로 대체하지 않는다.
로컬 기준은 fetch한 origin/main과 HEAD의 merge-base이고 기준을 얻지 못하면 실패한다.

predecessor에 checker와 baseline이 모두 없을 때만 P1의 최초 seed를 허용하고 seed는 실제 findings와 정확히 일치해야 한다.
checker가 있는데 baseline이 없으면 자동 재생성하지 않는다.
baseline을 없애는 retired 상태는 lint·Knip findings가 모두 0일 때만 허용하며 최종 이행에서 일반 오류 검사로 전환한다.
root `pnpm lint`는 앱 lint뿐 아니라 구조 검사와 Knip도 실행하고 required CI는 별도 명시 단계로 같은 계약을 실행한다.
설정·checker·baseline 경로 변경은 관련 CI lane을 선택하며 invocation과 SHA 전달을 contract test로 고정한다.

checker 자체는 PR head에서 실행되므로 predecessor 비교만으로 checker 변조까지 방지하지는 못한다.
이 잔여 위험은 필수 CI 경로 선택, invocation contract test, checker·baseline·설정 diff 리뷰로 완화하며 신뢰된 코드 실행과 동등하다고 주장하지 않는다.

#### 10.8 결정과 이행의 구분

이 절의 Accepted는 목표 구조와 명시한 S6·S8 예외의 승인이지 모든 모듈 이전이나 baseline 제거의 완료 판정이 아니다.
먼저 rails를 도입하고 baseline을 고정한 뒤 의존 순서에 따라 책임을 분리하고 모듈별 이행에서 해당 baseline을 줄인다.
완료 판정은 실제 실행한 검증과 연결된 Issue·PR에서만 기록하며 이 ADR에 진행 ledger를 복제하지 않는다.
schema 변경, AppModule 변경 필요, 승인하지 않은 API 변화 또는 잠금 응답 변화는 별도 결정 대상이다.

후속 F1은 enum·상태 단순화와 domain-owned enum 전환을 별도 migration 계획에서 검토하며 이번 개정에서는 실행하지 않는다.
후속 F3은 route manifest로 인증 계약 보존을 증명한 뒤 SessionGuard 단순화를 검토하며 현재 두 인증 guard는 유지한다.
후속 F4는 `@nestjs-cls/transactional` 같은 선언적 transaction 전파와 version column 기반 낙관적 잠금을 검토하며 라이브러리 도입·컬럼 추가·migration은 이번 범위가 아니다.
trackType idempotency hash 문제는 별도 [#1477](https://github.com/JNU-SWCU/oss-hub/issues/1477)에서 추적하고 이 계층 개정에 섞지 않는다.

## Alternatives considered

### 최상위 계층 폴더

- Pros: controller, service, repository 유형별 파일을 한곳에서 볼 수 있다.
- Cons: 하나의 기능을 이해하려면 여러 최상위 폴더를 오가야 하고 기능 응집도가 낮아진다.
- **Rejected:** 기능 모듈 폴더가 변경 단위와 탐색 단위를 일치시켜 유지보수에 유리하다.

### 클린 아키텍처

- Pros: 의존성 역전과 높은 교체 가능성을 강조한다.
- Cons: Team14_BE 경험에서 실제 요구보다 많은 계층이 생겨 인지 과부하와 구현 비용이 증가했다.
- **Rejected:** 현재 규모에서는 모듈 내 Layered 구조가 필요한 분리를 제공하면서 과잉 계층을 피한다.

### `COLLECTION_READ_PORT`를 유지한다

- Pros: consumer가 github 테이블을 직접 보지 않는다.
- Cons: 같은 DB 조회에 Gateway를 두면 in-process query bus가 되고, 한 줄 hop이 Service Layer와 겹친다.
- **Rejected:** 이 작업이 Port 삭제와 소비자 이관을 요구했다.

### ranking만 이관하고 programs/system-status는 다음 PR로 남긴다

- Pros: 이번 변경 폭이 작다.
- Cons: 같은 잘못된 Port가 남은 소비자에 그대로 산다.
- **Rejected:** 이 작업이 Port 삭제와 전 소비자 이관을 요구했다.

### staff-insights가 RankingService.findPublicActivity를 재사용한다

- Pros: fold 코드가 한곳이다.
- Cons: 한 줄 hop이 다시 Service Layer를 조회 버스로 만든다. 랭킹 질문(가입자 전원 순위 행)과 insights 질문(ACTIVE 학생 코호트)이 다른데 테이블이 같다고 빌린다. Table Data Gateway / repository-per-table이다.
- **Rejected:** 화면 질문마다 Repository를 둔다. fold가 두 벌인 것은 허용된 비용이다.

## Consequences

### Enables

- 기능별로 controller, service, repository, DTO, 도메인 코드를 함께 탐색한다.
- usecase별 트랜잭션 경계와 오류 변환의 책임 위치가 명확해진다.
- HTTP·업무 규칙·영속성의 변경 영향을 분리한다.
- 화면 질문 단위의 읽기 Repository가 같은 DB JOIN을 소유한다.
- staff-insights는 자기 Repository로 같은 활동 테이블을 읽는다. 랭킹 Service hop을 두지 않는다.

### Costs / trade-offs

- 단방향 의존성과 DTO/도메인 분리를 코드 리뷰에서 지속적으로 확인해야 한다.
- 매우 복잡한 외부 연동이 생기면 추가 분리의 필요성을 다시 평가해야 한다.
- 같은 DB 조회가 여러 소비자 Repository에 흩어진다.

### New constraints

- controller는 service를 거치지 않고 repository에 접근하지 않는다.
- Prisma DB 접근과 enum import의 구분은 §10.3을 따른다.
- repository는 업무 규칙과 HTTP 표현을 소유하지 않는다.
- Service는 Fowler Service Layer이며 한 줄 hop을 orchestration으로 치지 않는다. 다른 모듈 Service를 같은-DB 조회 버스로 쓰지 않는다.
- gateway와 주입 키는 §10.1·§10.2의 경계를 따르며 같은 DB 읽기 앞에 별칭 Port를 두지 않는다.
- staff-insights는 RankingService를 호출하지 않는다. 활성·연도·기준시각은 `StaffInsightsRepository`가 읽는다.
- 읽기 Repository는 테이블이 아니라 화면 질문 하나에 답한다.
- `github`는 소비자 모듈을 역import하지 않는다. 소비자 Service는 github concrete repository를 import하지 않는다.
- public query repository만 owner 승인된 strict-read allowlist 경계에서 explicit select로 공개 조회를 수행한다.
- controller와 일반 service는 Prisma로 DB에 직접 접근하지 않으며 private join은 dedicated public query repository 밖에서 금지한다.
- service가 트랜잭션 경계를 소유하며 전역 예외 필터를 우회하는 개별 응답 형식을 만들지 않는다.
- NestJS는 `setGlobalPrefix('api/v1')`로 API 접두사를 설정한다.
- eslint DEC-42는 이 결정에 맞게 다시 쓴다.
- CollectionReadService 조회는 소비자 Repository로 옮긴다 — RankingRepository(`ranking/`), ProgramActivityRepository·ProgramMetricsRepository(`programs/`), SystemStatusRepository. 다음 수집 tick은 `collection-schedule.ts`가 공유한다.
- `GET /ranking`은 전원 공개다. STUDENT는 익명과 같다. public entry는 rank·GitHub login·commit·PR 네 필드만 가지며 수집 시각 metadata는 공개한다. staff만 실명·학과·추가 집계와 CSV를 받는다.

## Changelog

- 2026-10-08: §10에 닫힌 계층 폴더, 주입 키, Prisma enum 허용, 단계별 잠금, 인증·권한 분리, storage 및 신뢰된 SHA 기반 rails 결정을 통합했다.
  S6의 쓰기 뒤 잠금 없는 재조회와 S8의 validation·Origin 우선 오류를 승인된 변경으로 기록하고 S4·S5·S7 조사 판단 및 미실행 후속 F1·F3·F4를 분리했다.
  ADR-010 §7·§8의 구조 규칙을 대체하며 Accepted와 전체 코드 이행 완료를 구분한다.
- 2026-08-25: 배포된 ranking response DTO를 wire 계약의 SSoT으로 명시하고, public/STUDENT entry를 `rank`·`githubLogin`·`commitCount`·`pullRequestCount` 네 필드로 정렬했다. 기존의 department 전원 공개 문장을 제거하고 ACTIVE staff/admin rich entry와 공개 페이지 metadata 경계를 기록했다 (#1027).
- 2026-07-11: initial decision
- 2026-07-31: 공개 strict-read를 dedicated allowlist repository로 한정하고 Controller→Service→Repository DTO 및 cross-module/external behavioral dependency의 Port-only 규칙을 명문화했다.
- 2026-08-04: DEC-42(collection 모듈의 `COLLECTION_READ_PORT` 전용 소비 경계)를 개정해, collection 수집원이 `ORG_PROVISIONED`/`EXTERNAL_PUBLIC` 두 가지로 늘어나도 그 차이(자격증명·discovery)를 흡수하는 지점은 collection 서비스 계층이며 Port 경계·delegate 접근 규칙 자체는 바뀌지 않음을 명시했다. 이 문서 본문에 `DEC-42` 식별자가 명시된 것은 이번이 처음이다 — 이전까지는 `eslint.config.mjs`·테스트·`AGENTS.md`가 이 결정을 "(ADR-003 DEC-42)"로 인용해 왔으나 ADR 본문에는 그 식별자가 없어 추적이 간접적이었다.
- 2026-08-09: DEC-42의 "새 Port를 만들지 않는다" 제약을 [ADR-010](ADR-010-contribution-tracking-context.md) §7로 개정했다. 기여 추적 port 3개 + 프로비저닝 port 별도 등재가 허용되며, Port 경계와 delegate 직접 접근 금지 규칙 자체는 변하지 않는다.
- 2026-08-20: `COLLECTION_READ_PORT`를 삭제하고 같은 DB 조회를 소비자 Repository로 옮겼다. eslint DEC-42를 다시 썼다. CollectionReadService 조회는 RankingRepository·ProgramActivityRepository·ProgramMetricsRepository·SystemStatusRepository로 이동했고, staff-insights는 자기 Repository로 같은 활동 테이블을 읽는다. 같은 날 `RankingService.findPublicActivity` hop을 삭제했다. 그 hop은 Port와 같이 Fowler Service Layer를 프로세스 안 조회 버스로 쓴 것이었고, 같은 테이블을 이유로 랭킹 질문을 insights가 빌리는 Table Data Gateway/repository-per-table이었다. 폐지 직전 DEC-42 문장은 다음이었다. 「collection 모듈의 cross-module 공개 surface는 `COLLECTION_READ_PORT` 토큰과 `CollectionReadPort`뿐이며(DEC-42), consumer 모듈(`programs`/`ranking`/`system-status` 등)은 concrete 구현이나 Prisma delegate를 직접 참조하지 않는다. collection의 수집원은 `ORG_PROVISIONED`(조직 소속 저장소)와 `EXTERNAL_PUBLIC`(학생이 등록한 조직 밖 public 저장소) 두 가지이며, 이 둘은 자격증명과 저장소 목록 discovery만 다르고 저장소 메타·commit·PR·release 수집, 커서·frontier, fact 적재, 연도 집계, 리스·전송 큐는 source와 무관하게 공유한다. 어느 source에 어떤 수집 전략을 쓸지 고르는 분기는 collection 서비스 계층의 책임이며, 이 분기가 `COLLECTION_READ_PORT`에 새 포트를 추가하거나 consumer에게 노출되는 테이블을 늘리지 않는다 — Port 경계 자체와 그 뒤의 단일 delegate 접근 규칙(DEC-42)은 이 확장으로 변하지 않는다. DEC-42의 "새 Port를 만들지 않는다"는 제약은 [ADR-010](ADR-010-contribution-tracking-context.md) §7로 개정됐다. 기여 추적 컨텍스트는 밖으로 여는 port를 기여 집계 · 공개 자격 · 건강 셋으로 두고, 프로비저닝 port(`REPOSITORIES_READ_PORT`)를 별도 등재한다 — 답하는 질문의 종류도, 변하는 주기도, 보는 사람도 넷이 서로 다르기 때문이다. Port 경계 자체와 그 뒤의 단일 delegate 접근 규칙은 그대로이며, 바뀐 것은 "port는 하나여야 한다"는 개수 제약뿐이다.」 이전 Changelog 2026-08-04·2026-08-09 항목은 그 문장의 이력을 가리킨다.

## References

- [Fowler, Patterns of Enterprise Application Architecture — Repository](https://martinfowler.com/eaaCatalog/repository.html)
- [Fowler, Patterns of Enterprise Application Architecture — Service Layer](https://martinfowler.com/eaaCatalog/serviceLayer.html)
- [Fowler, Patterns of Enterprise Application Architecture — Gateway](https://martinfowler.com/eaaCatalog/gateway.html)
- [Fowler, Patterns of Enterprise Application Architecture — Unit of Work](https://martinfowler.com/eaaCatalog/unitOfWork.html)
- [Fowler, Patterns of Enterprise Application Architecture — Table Data Gateway](https://martinfowler.com/eaaCatalog/tableDataGateway.html)
- [Fowler, Command Query Separation](https://martinfowler.com/bliki/CommandQuerySeparation.html)
- [Microsoft Learn: Designing the infrastructure persistence layer](https://learn.microsoft.com/en-us/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design)
- [NestJS Modules](https://docs.nestjs.com/modules)
- [NestJS Exception Filters](https://docs.nestjs.com/exception-filters)
- [ADR-004: REST API 규격](ADR-004-REST-API-규격.md)
