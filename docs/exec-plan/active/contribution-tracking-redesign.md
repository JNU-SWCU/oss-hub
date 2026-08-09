# 기여 추적 재설계 — 수집 입자 · 읽기 경로 · 모듈 경계

## 상태

> **승격 완료 — 이 문서는 더 이상 결정의 원본이 아니다.**
> 기여 추적 설계의 현재 원본은 **[ADR-010](../../decisions/ADR-010-contribution-tracking-context.md)**이다.
> 이 문서의 `D`·`R` 결정 중 상당수가 그 뒤 뒤집혔다 — 특히 `R28`(서브폴더 축소) `R29`(archive 분리) `R3`(port 2개) `R13` 정정 계열 `R10b`(discovery 제거) `D8`·`D8b`·`D14`(parity 게이트) `D37`(랭킹 필터)이 그렇다.
> **개별 결정을 여기서 인용하지 말고 ADR-010을 인용한다.** 이 문서는 그 결정에 이르는 과정의 기록으로만 남긴다.
>
> 뒤집힌 이유 둘: (1) 랭킹은 비어 있던 게 아니라 **멈춰 있었다** — 진단 후보 전체가 다른 질문을 겨냥하고 있었다. (2) 랭킹이 조직 밖 기여를 **이미 포함**하고 있었고 현재 수치의 지배적 원천은 `Application`이 없는 조직 저장소였다 — `D37`대로 필터를 걸었으면 랭킹이 0이 됐다.

관련 미결: #682(무엇을 기여로 세는가).

`collection/` 모듈은 소유자가 따로 있다.
루트 AGENTS.md §3에 따라 이 문서의 구조 변경은 직접 수정이 아니라 Issue/PR 제안으로 진행한다.

## 왜 여는가

fact·집계 테이블 분리는 끝났고 그 위에 service·API 계층을 쌓을 차례다.
그 과정에서 지금 구조의 세 가지가 걸림돌로 확인됐다 — 수집 입자가 연도로 미리 접혀 있고, 랭킹 읽기가 애플리케이션 메모리에서 집계되며, transport(REST/GraphQL) 선택이 도메인 규칙과 엉켜 있다.

인터뷰 10라운드를 거치며 범위가 커졌다.
처음에는 테이블 입자 교체였는데, 결정을 따라가 보니 **수집 관련 테이블 20장이 2장으로, GitHub 연동 모듈 3곳이 1곳으로** 줄어든다.

## 확정한 결정

| ID | 결정 | 근거 |
| --- | --- | --- |
| D1 | 수집 입자를 `(repository, person, date)`로 둔다 | 프로그램 기간은 달력 연도가 아니다 |
| D2 | 랭킹은 쿼리로 계산한다 — 스냅샷 테이블·캐시를 두지 않는다 | 지금 단계에서 캐시는 없는 문제를 푼다 |
| D3 | 랭킹에 실명을 공개하지 않는다 | PM 결정 |
| D4 | 서비스에 가입하지 않은 사람은 추적하지 않는다 | 동의 근거 없는 개인 추적을 만들지 않는다 |
| D5 | 추적의 스파인은 `Program × GithubRepository × User` 세 축이다 | 두 읽기 표면이 같은 바닥을 공유 |
| D6 | transport(REST/GraphQL)를 도메인에서 분리한다 | 수집 규칙이 프로토콜에 의존하지 않는다 |
| R1 | 데이터·공개 계약 전면 파괴를 허용한다 | |
| R2 | fact 3장을 폐기하고 전량 재계산 + DELETE/INSERT로 간다 | append-only는 force-push·PR 삭제 뒤 영구히 부풀고 자가교정이 없다 |
| R3 | 읽기 포트를 2개로 접고 controller/service/repository 번역 계층을 세운다 | 요청을 도메인 질의로 번역하는 계층이 있으면 범용 질의가 규칙 위반이 아니다 |
| R5 | 관리 API를 `system-status` 하나로 줄인다 | 배치 단위 boolean은 양방향으로 거짓말한다 |
| R6 | 작업 큐를 별도 테이블로 두지 않는다 — 저장소 컬럼 3개로 둔다 | 1:1 관계를 분리하면 조인만 는다 |
| R7 | 새 테이블 이름은 `Contribution` 이다 | grain을 이름에 박으면 grain이 바뀔 때 이름이 거짓말이 된다 |
| R7b | 날짜 축을 기간별·시계열로 노출하되 버킷은 경로별로 다르게 둔다 | 시계열은 "얼마나"가 아니라 "언제"에 답한다 |
| R8 | 재계산 작업 단위는 저장소다 | ME·CE를 둘 다 만족하는 유일한 단위 |
| R9 | 저장소 엔티티를 하나로 병합하고 이름은 `GithubRepository`로 둔다 | `Repository`는 계층형 아키텍처의 패턴 이름과 충돌한다 |
| R10 | 모듈은 데이터 소유권으로 가른다 — 소비자로 가르지 않는다 | 소유자가 둘이면 소유자가 없다 |
| R10b | 수집 대상은 조건절이 아니라 행의 존재로 정의한다 | 멤버십을 조건절로 쓰면 등록 경로가 늘 때마다 조건절을 찾아다녀야 한다 |
| R11 | 코드베이스의 bounded context는 넷이다 — identity · program · github · platform | 27개 모듈이 서로의 테이블을 넘나들고 있어 모듈 경계가 이름뿐이었다 |
| R12 | 이번 scope는 `github/` 하나만 컨텍스트로 세운다 | 넷을 동시에 재배치하면 진행 중인 diff와 전면 충돌한다 |
| R13 | `public-projects`는 `github/`로 흡수한다. `ranking/`은 정책 소유자로 남기되 `repository/`를 두지 않는다 | 표현 대상이 github 엔티티면 안, 우리 정책이 개입하면 밖 |
| R14 | 컨텍스트마다 같은 사물의 모델을 따로 갖는다 — GitHub은 aggregate root, Program은 value object | Prisma 스키마는 물리 저장 스키마이지 도메인 모델이 아니다 |
| R15 | 폴더는 `controller / scheduler / service / repository / domain / infrastructure / dto` | 이 repo에 `*.repository.ts`가 37개다. 헥사고날 어휘를 얹으면 팀이 두 어휘를 외운다 |
| R16 | 수집 도메인은 진입점이 둘이다 — HTTP(Controller)와 시간(Scheduler) | Scheduler는 Controller와 같은 급의 어댑터다. 판단하지 않고 Service를 부른다 |
| R17 | port는 entity가 아니라 결과 타입을 반환한다 | aggregate를 내보내면 `failureCount`·`nextRunAt`이 남의 도메인에 흘러 수집 스키마를 못 바꾸게 된다 |
| D7 | 랭킹 수치 = commit + PR + release 단순 합. 가중치 없음 | 지금 단계에서 기여의 질을 판정하지 않는다 |
| D7b | 그러므로 이름은 점수가 아니라 횟수다 — `total` → `activityCount`, 화면 "점수" → "활동 횟수" | 가중치가 없는데 점수라 부르면 하지 않은 판단을 했다고 주장하게 된다 |
| R18 | 읽기 쪽은 Repository가 아니라 Query다 — `*-contribution.query.ts` | DDD Repository는 aggregate 입출력이다. GROUP BY 집계는 Query Service다 |
| R19 | `SeoulDate` value object를 도입한다 | 날짜 경계 규칙이 주석에만 있다. 주석은 컴파일되지 않는다 |
| D8 | 전환 수용 기준 = 기존 집계 대비 값 parity. 단 0단계 결론에 조건부 | 누적이므로 같은 기간 같은 사람의 수치는 같아야 한다 |
| D8b | 비교 대상은 응답 JSON이 아니라 (사람, 연도) → commit·PR·release 세 수치 | D7b로 봉투가 바뀐다. R1이 계약 파괴를 허용했으므로 값만 같으면 된다 |
| D9 | D4는 identity port로 강제한다 — 스윕당 한 번 가입자 `githubId` 집합을 받는다 | github ↔ identity는 Customer/Supplier. 행마다 물으면 N+1이 된다 |
| D9b | identity 조회 실패 시 적재하지 않는다 (fail-closed) | 수집 지연은 되돌릴 수 있고 개인 데이터 유입은 되돌릴 수 없다 |
| R20 | 작업 영역은 셋이되 깊이가 다르다 — github 전면 / ranking 얕음 / program 표면만 | program 7개 모듈 재편은 다음 차례다(R12) |
| R21 | 실패는 유형으로 가른다 — 영구(저장소가 사라짐)와 일시(다시 하면 됨) | 404를 24시간마다 영원히 재시도하는 것과 429로 저장소를 격리하는 것은 둘 다 틀렸다 |
| R21b | 격리는 행 삭제가 아니라 `nextRunAt = NULL`이다 | 행을 지우면 그 저장소에 쌓인 기여 이력이 함께 사라진다. R10b도 깨진다 |
| R22 | 한 스윕에서 영구 판정이 배치의 절반을 넘으면 판정을 멈추고 스윕을 실패로 끝낸다 | 앱 토큰이 죽으면 모든 저장소가 401을 뱉는다. 그때 전량 격리하면 수집이 통째로 정지한다 |
| D10 | 건강은 지연으로 판정한다 — `stalestSuccessAge`와 `overdueCount` 둘 | 스윕 성공 여부는 cron이 아예 등록되지 않은 고장을 관측하지 못한다 |
| D10b | `stalestSuccessAge`는 격리된 저장소를 제외하고 계산한다 | 삭제된 저장소 하나가 영원히 경보를 울리면 사람은 경보를 끈다 |
| D11 | `system-status`는 admin(교직원) 전용이다 | 격리 목록과 실패 유형은 조직 내부 정보다 |
| D12 | 저장소당 재방문 목표 = 1시간. 배치·백오프·경보 임계는 여기서 계산된다 | 임계값은 고르는 값이 아니다. 주기 하나를 정하면 나머지가 따라 나온다 |
| D12b | 배치 상한은 시간당 API 예산의 절반이 허용하는 만큼이다 | 같은 토큰으로 프로비저닝·초대가 나간다. 배치가 사람이 기다리는 요청을 굶기면 안 된다 |
| D12c | 큐 정렬은 `ORDER BY nextRunAt ASC` — 가장 오래 굶은 것부터 | 고정 순서 순회는 예산이 부족해질 때 항상 같은 저장소를 굶긴다 |
| D13 | 계약 파괴는 백엔드와 프론트를 한 PR에 담는다 | 짝이 되는 조합이 하나뿐이어야 리뷰와 히스토리에 질문이 안 생긴다 |
| D13b | 그래도 배포가 분리돼 있으면 그 틈에 랭킹 화면이 깨진다. 이를 수용한다 | 읽기 전용이고 유실이 없고 새로고침이 복구다. 제출·결제 표면이면 다른 답을 골랐다 |
| D14 | parity는 배포 전에 shadow로 잰다 — 백필만 하고 읽기는 구 경로 유지 | 틀린 숫자를 보여준 뒤 되돌리면 코드는 revert돼도 신뢰는 revert되지 않는다 |
| D15 | 공개 랭킹은 `githubLogin`만 노출한다. 2026-08-03 실명 허용 결정을 철회한다 | 동의 철회 endpoint가 없는 상태(#554)에서 실명 노출은 되돌릴 수 없다 |
| R23 | `public-projects/` → `archive/`, 경로도 `/archive` | 사용자가 '공개 아카이브'라 부르는 것을 코드가 세 이름으로 부르고 있었다 |
| R24 | 모듈이 존재할 자격은 자기 것을 소유하거나 소비자가 여럿일 때다 | 소비자 하나짜리 74줄 모듈은 모듈이 아니라 규칙 하나다 |
| D16 | `showcase/`는 0단계 확인 후 모듈과 테이블 2장을 드롭한다 | 등록은 돼 있지만 `src` 안에 호출자가 없다 |
| R23c | archive의 도메인 문장은 "끝난 프로그램의 산출물 보존"이다 | 그래야 기여 질의가 "저장소 전체"가 아니라 "프로그램 기간 안"으로 잡힌다 |
| D17 | 공개 자격 규칙은 `archive/domain/` 한 곳에만 두고 랭킹도 같은 것을 쓴다 | 지금 두 사본의 규칙이 달라 같은 질문에 두 답이 나온다 |
| D18 | 팀원 명단은 `Program`이 소유한다. 기여는 LEFT JOIN으로 붙이고 없으면 0으로 표시한다 | 붙는 값이 없다고 주인 행이 사라지면 소유 관계가 뒤집힌다. 문서·발표 기여자가 화면에서 증발한다 |
| R25 | `Program`에 활동 시작일 컬럼이 없다 — `applicationStartAt`/`applicationEndAt`/`endAt`뿐이다 | "프로그램 기간"으로 기여를 자르려면 시작을 무엇으로 볼지가 먼저 정해져야 한다 |
| R26 | `Milestone`에도 시작일이 없다 — `dueAt` 하나뿐이다 | 운영자 모델("마일스톤에 시작과 끝이 있다")이 스키마보다 풍부하다. 시작일은 코드 밖에만 있다 |
| D20 | 기간 시작은 `applicationEndAt`으로 잡는다(잠정). `Program.startAt` 도입은 별도 Issue로 뺀다 | 컬럼 추가는 `programs/` 소관이고 폼·검증·백필이 따라온다. R12가 이번 scope를 `github/` 하나로 잠갔다 |
| D19 | 경계 규칙은 lint로만 강제한다. 기계가 확실히 잡는 3개만 걸고 나머지 3개는 리뷰에 남긴다 | 오탐이 나는 규칙은 꺼지고, 꺼진 규칙은 없는 것보다 나쁘다 — 남아 있다는 착각을 준다 |
| R27 | 이번 리팩토링에 새 이벤트 타입은 없다. 전체 시스템의 이벤트는 `REPOSITORY_PROVISION_REQUESTED` 하나뿐이다 | 테이블 상태가 통합 지점이다(R10b). 같은 사실을 이벤트로 한 번 더 만들면 어긋날 때 진실을 정하는 코드가 또 필요하다 |
| D21 | 격리는 admin이 `system-status`에서 pull로 본다. 팀 알림은 보내지 않는다 | 오탐 한 번이 학생 전체 오발송이 된다. push는 격리 판정이 실전에서 검증된 뒤에 논한다 |
| ~~D22~~ | ~~`program-overview/`는 이번 scope 밖~~ — **철회**. F5로 이번에 옮긴다 | HTTP 경로가 이미 `programs/:programId/overview`라 폴더만 옮기면 계약이 안 바뀐다. 원칙은 비용이 있을 때 쓰는 것이지 비용이 0인 데 쓰는 것이 아니다 |
| D23 | `program-overview/` → `programs/` 순수 이동(F5). 275줄을 `programs.service.ts`에 합치지는 않는다 | 이동과 로직 변경을 같은 PR에 담지 않는다는 규칙은 여기서도 유효하다 |
| R28 | 서브폴더 규약은 `domain/`·`dto/`·`cli/` 셋뿐이다. R15 재정정(철회 아님, 범위 축소) | 이미 `domain/` 11개·`dto/` 20개 모듈에 있는 관례다. 레이어를 폴더로 표현하지 않고 순도를 폴더로 표현한다 |
| R28b | `domain/`의 유일한 계약은 "프레임워크를 모른다" — `@nestjs/*`·`@prisma/client` import 0 | 폴더가 없으면 규칙은 서비스로 스며든다. D17의 사본 두 벌이 정확히 그렇게 생겼다 |
| R29 | 폴더는 도메인 경계와 보안 경계가 어긋날 때 **보안 경계**를 따른다 | 도메인이 이기면 유출을 리뷰로만 막게 된다. 리뷰는 바쁜 주에 샌다 — D19에서 lint를 고른 논리와 같다 |
| D24 | `archive/`는 `programs/` 안에 넣지 않는다. 대신 Context Map으로 소유를 기록한다 | archive는 도메인상 programs의 읽기 모델이 맞지만, 공개(익명) 표면과 인증 표면이 같은 lint 울타리에 들어가면 울타리가 사라진다 |

전제: 모든 사용자는 GitHub OAuth로 가입하므로 GitHub 계정을 반드시 가진다.
스키마가 이를 강제한다 — `User.githubId BigInt @unique`.

## R9 — 저장소가 두 번 존재하고 있었다

스키마 확인 결과 저장소가 두 테이블로 나뉘어 있고 **둘 사이에 FK가 없다.**

```
Repository        (플랫폼)  applicationId @unique · programId · teamId · githubRepositoryId @unique
GithubRepository  (수집)    githubRepositoryId @unique · 관측 상태
                            ↑ Program·Team·Repository 로 가는 relation 없음
```

`githubRepositoryId`라는 외부 시스템의 자연키로만 만난다.
DB가 정합성을 보장하지 않으므로 한쪽에만 있는 행을 막는 장치가 없다.
D5가 "스파인이 이미 연결돼 있다"고 적었던 것은 이 자연키 조인을 FK로 오인한 것이었다 — 정정한다.

또한 `Repository.programId`·`teamId`는 중복이다.
`Repository`는 `Application`과 1:1이고 `Application`이 이미 `programId`·`teamId`를 정식 FK로 갖는다.
유도 가능한 값을 컬럼으로 들고 있으면 그것은 캐시가 아니라 두 번째 진실이고, 두 개의 진실은 언젠가 갈라진다.

병합한다.
살아남는 이름은 `GithubRepository`다 — `*.repository.ts` 파일이 37개인 코드베이스에서 도메인 엔티티가 `Repository`라는 이름을 가져가면 그 데이터 접근 클래스는 `RepositoryRepository`가 된다.

소속은 `Application`이 소유한다 — FK는 의존하는 쪽이 갖는다.
저장소는 신청 없이도 저장소지만 "이 신청이 받은 저장소"는 신청 없이 성립하지 않는다.

## 최종 스키마

새로 생기는 테이블은 `Contribution` 1장이다.

```prisma
/// 한 행 = 이 저장소에서 이 사람이 이 날 남긴 기여의 집계.
/// grain은 @@id가 정의한다 — 이름에 넣지 않는다.
model Contribution {
  repositoryId String
  repository   GithubRepository @relation(fields: [repositoryId], references: [id], onDelete: Cascade)

  githubUserId BigInt

  /// Asia/Seoul 기준 날짜. 경계 해석은 쓰기 시점이 아니라 이 칸의 정의에만 있다.
  date DateTime @db.Date

  commitCount      Int @default(0)
  pullRequestCount Int @default(0)
  releaseCount     Int @default(0)

  updatedAt DateTime @updatedAt

  @@id([repositoryId, githubUserId, date])
  @@index([githubUserId, date])
  @@index([date])
}

model GithubRepository {
  id String @id @default(cuid())

  // 정체 — GitHub이 정하는 사실
  githubRepositoryId   BigInt @unique
  githubOrganizationId BigInt?
  nameWithOwner        String
  url                  String

  // 관측 상태 — 수집이 갱신
  defaultBranch String?
  archived      Boolean              @default(false)
  visibility    RepositoryVisibility @default(PRIVATE)
  presence      RepositoryPresence   @default(PRESENT)

  // 큐 — 수집이 갱신. 1:1 이므로 별도 테이블로 두지 않는다.
  // nextRunAt = NULL 은 "큐에서 빠졌다"는 뜻이다(R21b). 상태 enum을 따로 두지 않는다.
  nextRunAt     DateTime?  @default(now())
  lastSuccessAt DateTime?
  failureCount  Int        @default(0)
  lastFailureKind CollectionFailureKind?

  publishedAt DateTime?

  application   Application?
  contributions Contribution[]

  @@index([nextRunAt])
  @@index([visibility, publishedAt, id])
}

model Application {
  // 기존 programId · teamId 유지 — 소속의 원본은 여기다
  repositoryId String?           @unique
  repository   GithubRepository? @relation(fields: [repositoryId], references: [id])
}
```

행은 활동이 있는 날에만 생기므로 희소하다.
연도 값은 이 테이블의 날짜 범위 합이므로 연도 집계 테이블은 파생이 아니라 중복이 되고, 그래서 폐기한다.

## R2 — 누적은 유지된다. 다만 원장이 아니라 날짜 축으로

"기여는 히스토리 성격이니 누적이 맞다"는 판단은 옳고, `Contribution`이 이미 그 누적이다.
`(repo, person, date)` 시계열이며 과거 행은 사라지지 않는다.

버리는 것은 *이벤트 한 건짜리* 원장이지 히스토리가 아니다.

append-only 원장이 틀린 이유는 상류가 가변이기 때문이다.
force-push와 PR 삭제는 GitHub의 과거를 바꾸는데, insert-only 카운트는 위로만 드리프트하고 자가교정 경로가 없다.
전량 재계산 + 단일 트랜잭션 DELETE/INSERT는 줄어든 것도 반영한다.

안전장치가 하나 붙는다 — **fetch 성공 없이는 DELETE 하지 않는다.**
GitHub이 에러를 주면 트랜잭션이 시작하지 않고 기존 행이 그대로 남는다.
저장소가 GitHub에서 사라지면 `presence: MISSING`으로 두고 재계산 대상에서 뺀다.

원장을 버리면 "상류 이력이 바뀌었다"는 사실을 잃는다.
그 신호는 테이블이 아니라 로그로 남긴다 — 재계산이 기존 합계를 바꾸면 델타를 기록한다.

## R8 — 재계산 단위는 저장소다

MECE로 판정한다.

| 작업 단위 | ME | CE | 근거 |
| --- | :--: | :--: | --- |
| 저장소 | O | O | 모든 행이 `repositoryId` 하나를 갖고, 저장소마다 작업이 정확히 하나 |
| 저장소×사람 | O | X | 작업 목록은 현재 후보자에서 나오는데 행은 과거 전체에 있다 |
| 저장소×날짜 범위 | O | X | 윈도우 밖 행에 대응하는 작업이 없다 |

두 번째가 CE를 깨는 이유가 핵심이다.
**작업 목록의 출처와 데이터의 출처가 다르면 CE는 보장되지 않는다.**
팀을 나간 사람은 후보 목록에서 빠지지만 행은 남아 유령이 된다.

저장소 단위는 작업 목록도 `GithubRepository`, 행의 FK도 `repositoryId`라 같은 출처이므로 CE가 공짜로 성립한다.

I/O는 트랜잭션 밖, 쓰기만 트랜잭션 안에 둔다.
순서는 항상 전부 받아온다 → 메모리에서 집계한다 → 짧은 트랜잭션으로 쓴다.

## R10b — 수집 대상은 조건절이 아니다

수집 대상은 "가입한 사용자들의 저장소"이고, 신청을 거친 저장소는 그 정의에서 자동으로 포함된다.
`Application`은 정의가 아니라 그것을 알아내는 현재의 유일한 경로다.

따라서 큐 질의에 필터를 두지 않는다.

```sql
SELECT * FROM "GithubRepository" WHERE "nextRunAt" < now()
ORDER BY "nextRunAt" LIMIT 20 FOR UPDATE SKIP LOCKED
```

행이 있다는 것 자체가 대상이라는 뜻이다.
등록 경로가 나중에 늘어도 조건절을 찾아다닐 필요가 없다.

이 결정으로 **발견(discovery)이 통째로 사라진다** — 행은 등록될 때 생기지 발견될 때 생기지 않는다.

## R21 — 실패에는 종류가 있다

R6에서 큐를 저장소 컬럼으로 정했지만 `failureCount`가 계속 오를 때의 동작을 정하지 않았다.
그 구멍을 닫는다.

```sql
SELECT * FROM "GithubRepository" WHERE "nextRunAt" < now()
ORDER BY "nextRunAt" LIMIT 20 FOR UPDATE SKIP LOCKED
```

삭제된 저장소는 404를 영원히 반환하고 이 쿼리에 영원히 다시 잡힌다.
죽은 저장소가 배치 크기만큼 쌓이면 살아 있는 저장소의 차례가 오지 않는다.
반대로 429를 실패로 세어 격리하면, GitHub이 잠깐 느렸다는 이유로 멀쩡한 저장소를 잃는다.
그래서 횟수가 아니라 종류로 가른다.

| 신호 | 판정 | 처리 |
|---|---|---|
| 404 | 영구 — 저장소가 없어졌거나 이름이 바뀌었다 | `presence = ABSENT`, `nextRunAt = NULL` |
| 403 + `x-ratelimit-remaining: 0` | 일시 — secondary rate limit | 백오프 |
| 403 (그 외) | 영구 — 설치 권한이 이 저장소에서 회수됐다 | `nextRunAt = NULL` |
| 401 | 우리 문제 — 앱 토큰이 죽었다 | 저장소를 건드리지 않는다. 스윕을 실패로 끝낸다 |
| 429 · 5xx · timeout | 일시 | 백오프 |

`nextRunAt` 하나로 큐 소속과 격리를 모두 표현한다(R21b).
`WHERE nextRunAt < now()` 는 NULL을 절대 고르지 않으므로 격리에 별도 상태 enum이 필요 없다.
복구는 `nextRunAt`을 다시 채우는 일이고, 그 경로는 관리 API 하나(R5)를 통한다.

행을 지우는 선택지는 버린다.
`Contribution`이 `onDelete: Cascade`이므로 저장소 행을 지우면 그 저장소에 쌓인 기여 이력이 함께 사라진다.
저장소가 GitHub에서 사라졌다는 사실이 그 사람이 거기서 일했다는 사실을 지우지는 않는다.

R22는 판정 자체의 폭발 반경을 막는다.
설치 토큰이 만료되면 모든 저장소가 같은 코드로 실패하고, 유형 판정만 믿으면 전량이 한 번에 격리된다.
한 스윕에서 영구 판정이 배치의 절반을 넘으면 그것은 저장소들의 문제가 아니라 우리 자격증명의 문제로 본다.

## D10 — 건강은 "돌았는가"가 아니라 "밀렸는가"다

지금 스윕은 끝날 때마다 `insertedFactCount` · `inventoryComplete` · `cycleCompleted` · `stoppedForBudget` 를 남긴다(`collection-scheduler.service.ts:110-121`).
넷을 다 봐도 수집이 건강한지 판정할 수 없다 — 전부 정상인데 아무것도 안 들어오는 상태가 가능하다.
더 나쁜 것은 cron이 아예 등록되지 않은 경우다.
그러면 이 로그는 한 줄도 나오지 않고, 없는 이벤트는 경보를 만들지 못한다.

관측자가 아무 일도 하지 않아도 저절로 나빠지는 지표라야 침묵하는 고장을 잡는다.

| 지표 | 정의 | 무엇을 잡는가 |
|---|---|---|
| `stalestSuccessAge` | `now() - min(lastSuccessAt)`, 격리 제외 | 큐 전체가 밀렸다 — cron 사망, rate limit 병목 |
| `overdueCount` | `count(*) WHERE nextRunAt < now()` | 처리량이 유입을 못 따라간다 |
| `quarantinedCount` | `count(*) WHERE nextRunAt IS NULL` | 경보가 아니라 확인용 — 증가 추세만 본다 |

D10b가 중요하다.
격리된 저장소를 `stalestSuccessAge`에서 빼지 않으면 삭제된 저장소 하나가 영원히 경보를 울린다.
경보는 사람이 할 수 있는 일이 있을 때만 울려야 한다.

`system-status`(R5)는 admin 전용이다(D11).
격리된 저장소 이름과 실패 유형이 응답에 들어가고, "이 팀 저장소의 권한이 회수됐다"는 조직 내부 정보다.

### D12 — 주기 하나가 나머지를 정한다

저장소당 요청은 약 4회(commits GraphQL + PR + release)다.
설치 토큰 한도가 시간당 최소 5,000이므로 `4N ≤ 2500`, 즉 **N이 625까지는 매시간 전량이 돈다**.
6시간 주기는 예산을 아끼는 게 아니라 신선도를 그냥 버리는 선택이었다.

```
재방문 목표 = 1시간 (tick마다 전량)
배치 상한      B = floor(예산 × 0.5 / 4)        기본 625. 예산의 절반만 쓴다(D12b)
정렬           ORDER BY nextRunAt ASC           가장 오래 굶은 것부터(D12c)
성공 시        nextRunAt = now + 1h
일시 실패 시   nextRunAt = now + min(5분 × 2^(failureCount-1), 1h)
경보           stalestSuccessAge > 3h   (세 tick을 놓쳤다)
               overdueCount > N × 0.2   (다섯 중 하나가 밀렸다)
```

주기를 당긴다고 큐가 필요 없어지지 않는다. 오히려 큐가 있어야 당길 수 있다.

큐 없이 `for (const repo of allRepos)` 로 짜면 순회 순서가 늘 같다.
400번째에서 예산이 떨어지면 401번 이후는 처리되지 않고, 다음 시간에도 같은 순서로 돌아 **매번 같은 저장소가 굶는다**.
`ORDER BY nextRunAt ASC` 는 이 실패 양식을 구조적으로 없앤다 — 예산이 남으면 전량이 매시간 돌고, 부족해지면 굶주린 순서대로 밀린다. 코드는 바뀌지 않는다.

D12b는 배치가 사람을 굶기지 못하게 막는다.
같은 설치 토큰으로 저장소 프로비저닝과 초대가 나가고, 그건 사용자가 화면 앞에서 기다리는 요청이다.

백오프 상한은 정상 주기와 같게 둔다.
재시도 간격이 정상 주기보다 길어지면 그건 재시도가 아니라 방치이고, 영영 안 되는 저장소는 R21의 유형 판정이 따로 걷어낸다.

주기를 저장소마다 다르게 하는 적응형은 채택하지 않는다.
주기가 다르면 `stalestSuccessAge` 임계값도 저장소마다 달라져 방금 세운 판정 기준이 무너진다.
`nextRunAt`이 컬럼이므로 나중에 바꾸는 비용은 계산식 한 줄이다.

## D6 · transport — 신호마다 경로가 하나씩 고정된다

REST와 GraphQL 둘 다 남는다.
취향이 아니라 능력 차이 때문이다 — 설치 저장소 목록은 REST만 되고, 작성자별 커밋 전체 이력을 1포인트에 받는 것은 GraphQL만 된다.

| 신호 | 경로 | 근거 |
| --- | --- | --- |
| 커밋 | GraphQL `history(author:)` | 저장소×사람당 1포인트, 전체 이력. 볼륨 문제가 여기만 있다 |
| PR | REST 저장소 나열 | 작성자 서버측 필터가 양쪽 다 없다. 건수가 작다 |
| 릴리스 | REST 저장소 나열 | 위와 같다 |

**런타임 분기가 0개다.**
구현체가 여러 개인 것의 비용은 개수가 아니라 분기다 — 분기 없는 2개는 1개에 가깝고, 분기 있는 2개는 4개에 가깝다.

이전 초안의 "candidates 있으면 GraphQL, 없으면 REST 폴백" 분기는 폐기한다.

## R10 — 모듈은 소유권으로 가른다

GitHub App 연동이 두 벌 존재한다.

```
repositories/github-app.client.ts        205    프로비저닝용
repositories/github-app.token.ts         243
collection/collection-app.client.ts     1030    수집용
collection/collection-discovery.client.ts 349
```

octokit을 만지는 모듈이 세 곳이다 — `auth`, `collection`, `repositories`.

이것이 버그를 만드는 지점은 rate limit이다.
한도는 계정 단위인데 클라이언트가 둘이라 각자 자기가 쓴 양만 안다.
수집이 예산을 아껴도 프로비저닝이 소진하면 수집은 그 사실을 모른 채 429를 맞는다.
페이싱 큐가 둘이면 페이싱이 성립하지 않는다.

외부 시스템에 대한 연결은 한 모듈이 소유해야 한다.
그 시스템으로 무엇을 하느냐는 여러 모듈일 수 있다.

소비자(`ranking`, `programs`, `public-projects`, `public-eligibility`)를 안으로 들이지는 않는다.
소비자로 가르면 여러 폴더가 같은 테이블을 쓰게 되고 그 순간 공유 커널이 생긴다.
안에서 나누는 축은 소비자가 아니라 **방향과 권한**이다.

## R11~R14 — 경계는 폴더가 아니라 접근 경로다

모듈이 27개인 것 자체는 증상이 아니다.
21개 모듈이 각각 다른 테이블을 소유하고 있어 개수는 자의적이지 않다.
증상은 여러 모듈이 필요로 하는데 아무도 소유하지 않는 관심사가 있다는 것이고, GitHub 연결이 정확히 그것이다.

그런데 소유 테이블을 실제로 세어 보면 더 큰 것이 나온다.

```
application       applications · board · milestone-documents · notifications
                  · program-overview · programs · submissions          7개 모듈
repository        programs · program-overview · public-projects
                  · repositories · submission-reviews                  5개 모듈
milestone         milestone-documents · notifications
                  · program-overview · submissions                     4개 모듈
user              20개 중 19개                                          shared kernel
```

모듈 경계가 있는 척만 하고 있었다.
`user`는 컨텍스트로 잘라낼 대상이 아니라 상류에 두고 나머지가 참조만 하는 shared kernel이다.

aggregate로 다시 묶으면 컨텍스트는 넷이다(R11).

| 컨텍스트 | 소유 | 흡수되는 모듈 | read model |
| --- | --- | --- | --- |
| identity | user · consent · roleRequest · loginHistory · auditLog | users · auth · consents · roles · login-history · audit-log · profiles | — |
| program | program · application · team* · milestone* · submission* · board* | programs · applications · team-invitations · milestone-documents · submissions · submission-reviews · board | program-overview |
| github | githubRepository · contribution · repositoryInvitation · repositoryProvisionJob | collection · repositories · public-projects | ranking |
| platform | notification · outboxEvent · system-status | health · runtime-config · common | — |

`ranking`과 `program-overview`는 모양이 같다 — 소유 테이블 0장에 조인만 한다.
둘 다 컨텍스트가 아니라 read model이고, 자기가 읽는 데이터의 컨텍스트 안에 있어야 한다(R13).

이번 scope는 `github/` 하나만 세운다(R12).
넷을 동시에 옮기면 진행 중인 diff와 전면 충돌하고, 폴더 이동만으로는 `application`을 7개 모듈이 만지는 문제가 그대로 남는다.
오히려 같은 폴더 안이라는 이유로 서로 만져도 된다는 면죄부가 된다.

컨텍스트 하나를 세운다는 것은 폴더를 만드는 것이 아니라 넷을 동시에 정하는 것이다.

| 정할 것 | `github/`의 답 |
| --- | --- |
| aggregate root | `Repository` — `Contribution`은 그 안이다. cascade가 이미 그렇게 말하고 있다 |
| 컨텍스트 안 | githubRepository · contribution · repositoryInvitation · repositoryProvisionJob |
| 밖에서 들어오는 문 | port 하나. 다른 모듈은 이 테이블들을 Prisma로 만지지 않는다 |
| 참조 방향 | program → github 단방향. `Repository`는 programId·teamId를 모른다(R9) |

`Application.repositoryId`가 GitHub을 가리키는 것이 DDD가 말하는 컨텍스트 간 ID 참조다.
하류가 상류를 가리키지 그 반대가 아니다.

### R15·R16 — 폴더는 NestJS 관례로, 진입점은 둘로

폴더 어휘는 이 repo가 이미 쓰는 것을 따른다 — `*.repository.ts`가 37개 있는 곳에 헥사고날 어휘를 얹으면 팀이 두 벌을 외운다.
`controller / service / repository / domain / dto` 위에 둘만 더한다.

`infrastructure/`를 `repository/`와 나누는 이유는 추상화 대상이 다르기 때문이다 — 하나는 우리 DB(Prisma)를, 하나는 남의 시스템(octokit)을 감싼다.
`scheduler/`를 따로 두는 이유는 진입점이 둘이기 때문이다.

```
HTTP    → Controller ─┐
                      ├→ Service → Repository → Prisma
@Cron   → Scheduler ──┘
```

Scheduler는 Controller와 같은 급이다 — 바깥 세계를 도메인 언어로 번역해 Service에 넘길 뿐 판단하지 않는다(R16).
수집 도메인이 다른 도메인과 달라 보였던 이유는 계층이 달라서가 아니라 진입점이 하나 더 있어서다.

```
src/
├── github/            사실 소유 + cron + 프로비저닝
│   ├── controller/    public-projects — 저장소 자체를 나열하는 표면
│   ├── scheduler/     @Cron → due 저장소를 큐에서 꺼낸다. 판단 없음
│   ├── service/       ingest — fetch → 집계 → 재계산 트랜잭션
│   ├── repository/    github-write / public-contribution / internal-contribution
│   ├── domain/        Repository aggregate · Contribution · ContributionQuery
│   ├── infrastructure/ github-app.client(rate limit 큐) · contribution-source
│   ├── dto/
│   ├── github.port.ts  aggregate · findPublishState · health
│   └── github.module.ts
│
├── ranking/           정책 소유. repository/ 를 두지 않는다
│   └── controller/ service/ domain/ dto/
│
└── program/           기존 7개 모듈. 이번 scope 밖(R12)

programs/domain/repository-ref.ts     value object 3칸. 경계 감시 지점
```

`identity`(users·auth·roles·consents…)와 `platform`(notifications·system-status…)은 이번 scope에서 건드리지 않는다.

### R13 정정 — ranking은 남는다

앞선 라운드에서 `ranking`이 테이블을 0장 소유한다는 사실만 보고 흡수 대상으로 판정했으나, 소유의 대상이 테이블만은 아니다.

> `github/`은 GitHub이 우리에게 말해준 사실을 소유한다.
> `ranking/`은 그 사실로 우리가 무엇을 하기로 했는가를 소유한다.

D3(표시명은 githubLogin)·정렬 기준·동점 처리·페이지 크기는 전부 우리 정책이지 GitHub 사실이 아니다.
`github/`에 넣으면 "GitHub이 말한 것"과 "우리가 정한 것"이 한 폴더에 섞이고, 프로그램별 랭킹이 생겨 program까지 읽게 될 때 빠져나올 수 없다.

`ranking/`이 모듈로 성립하는 조건은 하나다 — **`repository/` 폴더가 없어야 한다.**
만들면 그 안에 `contribution` 쿼리가 들어가고, 그건 경계 붕괴를 폴더 안에 숨긴 형태다.
Service가 남의 Repository를 부르는 것은 눈에 띄지만, 자기 폴더에 남의 테이블 repository를 두면 띄지 않는다.

### R13 재정정 — public-projects도 남는다

"표현 대상이 github 엔티티면 안"이라는 기준으로 `public-projects`를 흡수 대상으로 판정했으나 기준이 틀렸다.
모듈의 실제 Prisma 사용을 읽으면 이렇다.

```
public-projects/ → githubRepository, collection집계, program, team, teamMember, application, userProfile
```

github 테이블은 절반이고 나머지는 프로그램 맥락이다.
통째로 옮기면 `github/`이 program 테이블을 읽게 되고, 그것은 R11이 진단한 경계 누수를 새 폴더에서 재현하는 일이다.

올바른 기준은 "무엇을 표현하는가"가 아니라 "무엇을 소유하는가"다(R10).
`public-projects`는 아무것도 소유하지 않고 셋을 조합할 뿐이므로 소비자로 남아 port를 부른다.

**흡수 기준은 하나다 — `GithubRepository` 테이블을 쓰거나 GitHub API를 부르는 모듈만 들어간다.**

모듈이 존재할 자격은 둘 중 하나다 — 자기 것을 소유하거나, 소비자가 여럿이거나.
소비자를 실제로 세어 판정한다.

| 폴더 | 처분 | 근거 |
| --- | --- | --- |
| `collection/` | → `github/` | `githubRepository` + 수집 테이블 소유 |
| `repositories/` | → `github/` | `github-app.client.ts` · 프로비저닝 · 초대. 예산이 하나여야 한다(D12b) |
| `public-projects/` | **→ `archive/` 로 개명** | 공개 아카이브의 백엔드다. 아래 R23 |
| `public-eligibility/` | → `archive/` 안으로 | 74줄, 프로덕션 소비자가 `public-projects` 하나뿐 |
| `showcase/` | **삭제 후보** | 소유는 하는데 `src` 안에 호출자가 0이다 |
| `program-overview/` | **→ `programs/` (F5, 이번에)** | 소유 없음. 275줄짜리 조합. 경로가 이미 `programs/` 아래라 계약 무변경 |
| `ranking/` | 남는다 (얕게 수정) | Prisma 직접 호출 0건. 이미 정책만 갖고 있다 |
| 나머지 | 무변경 | github 데이터는 port로 받는다 |

```
27 -1(github 병합) -1(archive 병합) -1(showcase 드롭) -1(program-overview 흡수) = 23
```

`archive/`를 `programs/` 안에 넣지 않는 이유는 R29·D24에 있다 — 도메인은 그쪽이 맞지만 공개/비공개 경계가 더 강하다.

### R23 — 이름이 셋인 기능이 있다

```
사이드바 '공개 아카이브' → /archive → features/archive/api.ts
                                        ↓ GET projects, projects/category-counts, projects/:id
                                      src/public-projects/   @Controller('projects')
```

| 층 | 부르는 이름 |
| --- | --- |
| 사용자가 보는 메뉴 | 공개 아카이브 |
| 프론트 폴더·라우트 | `archive` |
| 백엔드 폴더 | `public-projects` |
| HTTP 경로 | `/projects` |

Ubiquitous Language의 규칙은 하나다 — 사용자가 쓰는 말이 코드의 말이어야 한다.
이름이 층마다 다르면 "아카이브가 안 된다"는 문의를 받은 사람이 `archive`를 grep해도 백엔드에서 아무것도 찾지 못한다.

`public-projects/` → `archive/`, HTTP 경로도 `/archive` 로 맞춘다(R1이 계약 파괴를 허용한다).

### R23c — archive는 "끝난 프로그램"이다

백엔드 `public-projects/`에는 `endAt` 필터가 없다. 버그가 아니라 규칙이 다른 곳에서 이미 실행됐기 때문이다.

```
submission-reviews/ findPublishEligibility
  → application.program.endAt + milestone 제출 완료를 본다     "공개해도 되는 시점인가"
  → 통과하면 Repository.publishedAt 을 세운다                   판정 결과가 컬럼으로 굳는다
archive/
  → publishedAt 이 있는 것만 후보로 삼는다                       이미 걸러진 것을 받는다
```

판정 시점(프로그램 종료)과 조회 시점(매 요청)을 분리한 것은 옳다.
매 조회마다 `endAt`을 다시 계산하면 프로그램 하나가 늦게 끝났다는 이유로 과거 아카이브가 통째로 흔들린다.

도메인 문장은 "공개된 프로젝트 목록"이 아니라 **"끝난 프로그램의 산출물 보존"** 이다.
`Contribution`을 붙일 때 자연스러운 질의가 "저장소의 전체 기여"가 아니라 **"프로그램 기간 안의 기여"** 가 되기 때문에 이 구분이 필요하다.
끝난 프로그램의 아카이브에 종료 후 커밋이 섞이면 그것은 아카이브가 아니다.

### D18 — 명단은 기여가 소유하지 않는다

팀원 명단의 주인은 `Program`/`Team`이고 `Contribution`은 거기 붙는 값이다.
붙는 값이 없다고 주인 행이 사라지면 소유 관계가 거꾸로 뒤집힌다.
`INNER JOIN`이 아니라 `LEFT JOIN`이고, 기여가 없으면 0으로 표시한다.
문서·발표·디자인만 맡은 팀원이 화면에서 증발하지 않는 것은 부수 효과다.

`Contribution`은 활동이 있는 날에만 행이 생기므로, 이 규칙이 없으면 0기여자는 조인 단계에서 조용히 사라진다.

### R25 — 프로그램에 활동 시작일이 없다

`collection/` 안에 `endAt` 참조는 0건이다 — 수집은 프로그램이 끝났는지 모른다.
저장소 행이 살아 있는 한 계속 방문하고 계속 적재하므로, 끝난 프로그램의 아카이브 수치가 조회할 때마다 커진다.
보존값이 움직이면 작년 선정 근거를 오늘 다시 열었을 때 숫자가 다르다 — 그건 기록이 아니라 대시보드다.

종료 후 커밋이 쌓이는 것 자체는 "프로젝트가 살아있다"는 진짜 신호지만, 그것은 보존값과 다른 지표다.
한 숫자에 섞으면 둘 다 읽을 수 없다.

자르는 비용은 없다 — R7b에서 port가 이미 기간을 받는다.
막는 것은 스키마다.

```
model Program
  applicationStartAt DateTime      신청 접수 시작
  applicationEndAt   DateTime      신청 마감
  endAt              DateTime?     프로그램 종료 (null = 미종료)
  (활동 시작일 컬럼 없음)
```

`applicationStartAt`은 접수를 여는 날이지 활동을 시작하는 날이 아니다.

### R26 — 마일스톤에도 시작일이 없다

```
model Milestone
  programId  String
  name       String
  dueAt      DateTime      마감일 하나뿐
  (startAt 없음)
```

운영 모델은 "마일스톤에 시작과 끝이 있다"인데 스키마는 마감일만 저장한다.
시작일은 공지와 Notion에만 있고 코드는 모른다.
운영자 머릿속 모델이 스키마보다 풍부한 것은 흔한 격차이고, 나중에 "왜 숫자가 이상하지"의 원인이 된다.

지금 스키마로 세울 수 있는 시간축은 이것뿐이다.

```
applicationStartAt ──── applicationEndAt ──── dueAt#1 ──── dueAt#2 ──── endAt
     신청 열림              신청 마감          첫 마감      둘째 마감      종료
                              ↑
                       "활동 시작"에 가장 가까운 것
```

### D20 — 기간 시작은 `applicationEndAt`(잠정)

`Program.startAt` / `Milestone.startAt` 추가는 `programs/` 소관이다.
컬럼만이 아니라 교직원 폼, 검증(시작 < 마감), 기존 행 백필까지 따라온다.
R12가 이번 scope를 `github/` 하나로 잠갔으므로 여기서 프로그램 스키마를 열면 PR 하나가 두 컨텍스트를 동시에 바꾼다 — 별도 Issue로 뺀다.

잠정인 이유는 근사치이기 때문이다 — 신청 마감 전에 미리 시작한 팀의 사전 작업은 빠진다.
나중에 `startAt`이 생기면 한 줄만 바뀌도록 port 시그니처는 `(from, to)`로 둔다(R7b에서 이미 그렇게 정해져 추가 비용이 없다).

### D19 — 경계는 lint로만 강제한다

| # | 규칙 | lint | 상태 |
| --- | --- | --- | --- |
| 1 | Controller가 Prisma를 직접 부르는가 | 가능 | 이미 있음 (`controllerPrismaImportPattern`) |
| 2 | Controller에 비즈니스 로직이 있는가 | 불가 | 리뷰 |
| 3 | Service에 Prisma query가 직접 들어가는가 | 가능 | 신규 |
| 4 | Repository가 비즈니스 의사결정을 하는가 | 불가 | 리뷰 |
| 5 | Scheduler가 Repository를 직접 부르는가 | 가능 | 신규 |
| 6 | RepositoryRef에 칸이 늘었는가 | 불가 | 리뷰 |

`eslint.config.mjs`는 모듈 목록을 돌며 경계 규칙을 생성하고 있으므로 3·5번 추가는 패턴 두 줄이다.

2·4·6번을 lint로 억지로 만들지 않는다.
"비즈니스 로직"을 정규식으로 정의하면 오탐이 나고, 오탐이 나면 다음 사람이 규칙 전체를 끈다.
규칙은 꺼지는 순간 없는 것보다 나쁘다 — 남아 있다는 착각을 준다.

`collectionInternalGroups` / `collectionReverseImportGroups`는 `collection` → `github` 개명 때 이름만 따라간다(F1).

### R27 — outbox는 이벤트 버스가 아니다

```
전체 시스템의 이벤트 타입:  REPOSITORY_PROVISION_REQUESTED   ← 1개
  producer:  applications/applications.repository.ts   (신청 승인 시)
  consumer:  repositories/repository-outbox.consumer.ts
```

`OutboxEvent`에 `type`·`aggregateType` 칸이 있어 범용처럼 보이지만 실제로 흐르는 것은 한 종류뿐이다.
스키마의 야심과 실제 사용량이 다른 경우이고, 이것을 "우리는 이벤트 기반이다"로 읽으면 잘못된 전제 위에 설계하게 된다.

그 하나는 제자리에 있다 — `applications/`(프로그램 컨텍스트)가 `repositories/`(GitHub 컨텍스트)에 일을 넘기는 지점이라 컨텍스트 경계를 건너며 트랜잭션을 끊는 outbox 본래 용도에 맞는다.
F2로 `repositories/`가 `github/`에 흡수돼도 경계는 그대로이므로 이 이벤트는 살아남는다.

새 이벤트 타입은 만들지 않는다.
R10b가 이미 "수집 대상 = 행의 존재"로 정했으므로 프로비저닝이 행을 쓰면 다음 스윕이 집는다 — "프로비저닝 완료" 이벤트는 중복이다.
랭킹도 D2에서 캐시 없는 라이브 쿼리이므로 "수집 완료" 이벤트가 필요 없다.
같은 사실이 테이블과 이벤트 두 곳에 생기면 둘이 어긋날 때 어느 쪽이 진실인지 정하는 코드를 또 써야 한다.

### D21 — 격리는 pull로만 알린다

```
저장소 삭제됨 → 404 반복 → 격리(nextRunAt = NULL)
                              ↓
                  system-status 의 quarantinedCount 가 오른다
                              ↓
                  admin 이 화면을 열어봐야 안다        ← pull
```

팀은 모른다.
학생이 저장소를 private으로 돌리거나 지우면 화면에서는 기여 수치가 안 오를 뿐이고, 아무도 안 열어보면 학기 끝까지 간다.
D10의 "없는 이벤트는 관측되지 않는다"가 여기서 다시 나오되 관측자가 admin이 아니라 팀이다.

그럼에도 이번 scope에서는 push를 넣지 않는다 — 오탐 한 번이 학생 전체 오발송이 된다.
격리 판정(R21/R22)이 실전에서 검증된 뒤에 논한다.

### D22 재정정 — 옮긴다 (철회)

컨트롤러 전체에 `SessionGuard`가 걸려 있다 — 두 endpoint 모두 로그인이 필요하다.
주석의 "공개 팀 목록"은 비로그인 공개가 아니라 같은 프로그램 참여자에게 공개라는 뜻이다.

```
GET /programs/:programId/overview
  → features/programs/program-overview-api.ts        프로그램 상세 팩트 바 + shell 뱃지
GET /programs/:programId/overview/teams
  → features/programs/program-teams-page.tsx         프로그램 팀 목록 (#701)
```

서비스 275줄이 하는 일은 보는 사람의 역할에 따라 같은 화면의 숫자를 다르게 채우는 것이다.

```
STUDENT      내 팀이 낸 마일스톤 / 전체 마일스톤
STAFF·ADMIN  서류를 다 낸 팀 수 / 참여 팀 수
역할 미확정   전부 비움
```

자기 테이블이 하나도 없고 `Program`·`Team`·`TeamMember`·`Milestone`·`Submission`을 조합만 하므로 R24 기준으로는 `programs/`가 원래 자리다.
프론트는 이미 `features/programs/` 안에 두고 있다 — 프론트가 프로그램 기능으로 보는 것을 백엔드만 따로 떼어 놓은 상태다.

처음에는 R12(scope는 `github/` 하나)를 들어 A4 Issue로 미뤘으나 철회한다.
HTTP 경로가 이미 `programs/:programId/overview`이므로 폴더와 module 등록만 옮기면 계약이 바뀌지 않는다 — 프론트 무변경, `/archive` 개명(F3)보다 오히려 싸다.
**원칙은 비용이 있을 때 쓰는 것이지 비용이 0인 데 쓰는 것이 아니다.**

`programs/`의 기존 컨트롤러 경로와 충돌하지 않는다.

```
programs                        programs/:programId/teams
programs/application-templates  milestones
dashboard/student               programs/:programId/overview   ← 들어올 자리
```

서비스 275줄을 `programs.service.ts`에 합치지는 않는다(D23) — 파일째로 들어가고 합치는 것은 별개 판단이다.
순수 이동과 로직 변경을 같은 PR에 담지 않는다는 규칙이 여기서도 그대로다.
역할별 통계 규칙을 `programs/domain/`으로 추출하는 것은 F5 다음 단계다.

### R28 — 서브폴더는 순도를 표현한다

전 모듈 서브폴더 현황이다.

```
domain/  11개 모듈    applications auth consents login-history milestone-documents
                      public-eligibility ranking roles submission-reviews submissions users
dto/     20개 모듈    거의 전부
cli/      3개 모듈    collection notifications submissions
```

규칙은 이미 이 repo의 관례이고, 빠진 곳이 정확히 이번 작업 대상이다.

| 대상 | domain/ | dto/ | 진단 |
| --- | --- | --- | --- |
| `ranking/` | 있음 | 있음 | 이미 맞다 |
| `collection/` → `github/` | 없음 | 있음 | 규칙이 서비스 안에 흩어져 있다 |
| `repositories/` → `github/` | 없음 | 있음 | 같음 |
| `programs/` | 없음 | 있음 | 275줄 역할 분기가 서비스에 있다 |
| `public-projects/` → `archive/` | 없음 | 있음 | 규칙이 옆 모듈 `public-eligibility/domain/`에 있다 |

마지막 줄이 D17의 원인이다.
`public-projects/`에 `domain/`이 없어 공개 자격 규칙이 갈 곳이 없었고, 그래서 옆에 모듈을 새로 만들었다가, 랭킹은 그것을 쓰지 못하고 자기 서비스 안에 사본을 하나 더 만들었다.
**폴더가 없으면 규칙은 서비스로 스며든다.**

lint와도 이어진다 — `eslint.config.mjs`는 이미 `../${other}/domain/*`·`../${other}/dto/*` 참조를 금지하지만, 폴더가 없는 모듈에서는 그 규칙이 아무것도 막지 않고 있었다.
채우는 순간 기존 lint가 비로소 일한다.

```
github/
  domain/    순수 규칙 — @nestjs/*, @prisma/client import 0
  dto/       HTTP 경계 표현
  cli/       (collection/cli 그대로)
  *.controller.ts  *.service.ts  *.repository.ts  *.scheduler.ts   ← 루트 유지
```

R15 재정정이되 철회가 아니라 범위 축소다.
헥사고날 폴더(`adapters/`·`ports/`·`application/`)를 만들지 않고 `*.repository.ts` 37개는 루트에 그대로 둔다는 R15는 유효하다.
서브폴더는 `domain/`·`dto/`·`cli/` 셋뿐이다 — **레이어를 폴더로 표현하지 않고 순도를 폴더로 표현한다.**

각 `domain/`에 들어갈 것:

```
github/domain/    SeoulDate(R19) · 실패 분류(R21) · 재방문 간격 계산(D12) · RepositoryRef
archive/domain/   공개 자격 판정(D17, public-eligibility 흡수) · 프로그램 기간 계산(D20)
ranking/domain/   활동 횟수 합산(D7) · 표시명 규칙(D15)          ← 이미 있음
programs/domain/  뷰어 역할별 통계 규칙 (F5 다음 단계)
```

### R29 · D24 — archive는 programs 안에 넣지 않는다

archive가 프로그램의 읽기 모델이라는 판단 자체는 맞다.
R23c의 도메인 문장이 "끝난 **프로그램**의 산출물 보존"이고, `public-projects`가 읽는 테이블의 절반(`program`·`team`·`teamMember`·`application`·`userProfile`)이 프로그램 것이다.

그러나 폴더를 중첩하면 경계가 사라진다.

```js
// eslint.config.mjs:13-18
const moduleNames = fs.readdirSync(srcDir, ...)
  .filter(entry => entry.isDirectory() && !sharedDirs.has(entry.name))
```

**모듈 = `src` 바로 아래 폴더다.**
`programs/archive/`로 넣으면 그것은 모듈이 아니라 `programs/` 내부이고, 경계 lint가 하나도 걸리지 않는다.

같은 울타리에 들어가는 것을 나열하면 문제가 분명해진다.

```
programs/    신청서 내용, 심사 결과, 학번·연락처, 역할, 제출 파일   인증 필요
archive/     비로그인 익명이 보는 공개 응답                        인증 없음
```

`docs/rules/security.md`는 공개 endpoint의 private 테이블 읽기를 "owner-approved **dedicated** public query repository 경계에서만" 허용한다.
그 경계를 코드에서 가리키려면 폴더여야 하고, 합치면 가리킬 폴더가 없어진다.

지금까지의 이동과 종류가 다르다.

| 이동 | 무엇을 넘는가 | 비용 |
| --- | --- | --- |
| `program-overview` → `programs` | 아무것도 — 같은 컨텍스트, 같은 인증 | 0 |
| `collection`+`repositories` → `github` | 아무것도 — 같은 토큰, 같은 외부 시스템 | 0 |
| `archive` → `programs` | **공개/비공개 경계** | 경계 lint 무효화 + security.md 예외 근거 소멸 |

소유는 폴더 중첩이 아니라 **의존 방향**으로 표현한다.

```
programs  (Supplier)  ──→  archive  (Customer)
          프로그램·팀·마일스톤이 진실        끝난 것만 읽어 공개용으로 표현
          archive는 programs의 port로만 읽고 Prisma를 직접 보지 않는다
          역참조(programs → archive)는 lint로 금지
```

`collection` ↔ 소비자에 이미 걸려 있는 `collectionReverseImportGroups`와 같은 패턴이다.

최종 배치는 23개다.

```
27 -1(github 병합) -1(archive 병합) -1(showcase 드롭) -1(program-overview 흡수) = 23

github/    ← collection + repositories              domain/ dto/ cli/
archive/   ← public-projects + public-eligibility   domain/ dto/
ranking/                                            domain/ dto/   (이미 맞음)
programs/  ← + program-overview                     domain/ dto/
```

이전 라운드에 적은 "27→23"은 개명을 소멸로 한 번 더 센 오류였다 — 그 시점의 정답은 24였고, `program-overview`까지 옮기면서 23이 됐다.

### D17 — 공개 자격 규칙이 두 벌이다

| 위치 | 규칙 | 신선도 fence |
| --- | --- | --- |
| `public-eligibility/domain/` | `visibility` + `presence` + `visibilityObservedAt` | 있음 |
| `collection-read.service.ts:326` | `visibility: PUBLIC, presence: PRESENT` (인라인) | 없음 |

랭킹은 두 번째를, 아카이브는 첫 번째를 쓴다.
저장소가 private으로 바뀐 뒤 재관측 전이면 아카이브에서는 사라지는데 랭킹에는 남는다 — 유출은 아니지만 같은 질문에 두 답이 나온다.

규칙은 `archive/domain/` 한 곳에만 두고 랭킹도 같은 것을 쓴다.
신선도 fence가 랭킹에도 걸리지만 D12로 관측이 매시간이므로 최대 지연은 1시간이다.

`public-eligibility.service.ts` 주석은 "list/detail/profile/ranking 행 선택이 이 서비스 하나를 공유한다"고 적혀 있으나 실제 소비자는 `public-projects/` 둘뿐이다.
주석이 코드보다 넓게 주장하면 다음 사람은 확인 없이 믿는다 — 흡수할 때 함께 고친다.

`ranking/`과는 합치지 않는다.
사이드바에 '공개 아카이브'와 '랭킹'이 따로 있고 사용자가 둘을 다르게 부른다.
사용자가 구분하는 것을 코드가 합치면 코드가 사용자보다 똑똑한 척을 하게 된다.
둘이 공유하는 것은 폴더가 아니라 규칙 하나이고(D15: 공개 응답은 `githubLogin`만), 그것은 `common/`의 공개 필드 allowlist에서 강제한다.

`showcase/`는 `app.module.ts:49`에 등록돼 있지만 `ShowcaseProjectionService`를 부르는 곳이 `showcase/` 밖에 없다.
컨트롤러도 cron도 outbox 핸들러도 없고, `PublicShowcaseRepository`·`PublicShowcaseContributor` 두 테이블은 아무도 채우지 않는다.
지금 아카이브는 프로젝션 없이 원본을 조인해 읽으므로, 이 모듈은 배선 직전에 멈춘 시도로 보인다.
0단계에서 `prisma/seeds`와 외부 호출까지 확인한 뒤 G1에서 모듈과 테이블 2장을 함께 드롭한다.

`repositories/`를 같이 흡수해야 하는 이유는 예산이다.
프로비저닝·초대가 수집과 **같은 설치 토큰**을 쓰는데, 두 모듈이 각자 GitHub 클라이언트를 들면 D12b(예산의 절반)를 집행할 주체가 없다.
rate limit이 계정 단위인데 클라이언트가 둘이면 예산 정책은 코드로 표현되지 않는다.

폴더 개수는 27 → 25로 둘밖에 줄지 않는다. 이 리팩토링이 줄이는 것은 폴더가 아니라 테이블(20 → 2)과 GitHub API 호출 지점(3 → 1)이다.

### R17 — port는 entity를 내보내지 않는다

```ts
findRepository(id): Promise<Repository>   // nextRunAt · failureCount · presence 가 전부 딸려 나간다
```

`Repository` aggregate에는 수집 큐와 관측 상태가 들어 있다.
이것이 `ranking`·`programs`로 넘어가면 그쪽이 `failureCount`를 보고 판단하기 시작하는 것은 시간 문제이고, 그러면 수집 스키마를 바꿀 때마다 남의 도메인이 깨진다.

```
Prisma model → Repository → Domain entity → (port 경계) → 결과 타입 → 다른 도메인
                                             여기서 잘린다
```

"Prisma 타입을 Controller까지 흘리지 않는다"와 같은 논리를 컨텍스트 경계에 한 번 더 적용한 것이다.

### R14 — 같은 테이블, 다른 모델

Prisma 스키마는 도메인 모델이 아니라 물리 저장 스키마다.
DDD는 같은 실세계 사물의 모델이 하나여야 한다고 말하지 않는다 — 컨텍스트마다 자기 모델을 따로 갖는 것이 bounded context의 정의다.

| | github | program |
| --- | --- | --- |
| 하는 일 | 수집하고 상태를 관리한다 | 신청서에 딸린 산출물로 표시한다 |
| 필요한 것 | 정체 + 관측 상태 + 큐 + 기여 | 이름과 링크 |
| 모델 | `Repository` aggregate root | `RepositoryRef` value object |
| 행동 | `markArchived()` · `scheduleRetry()` | 없다 |

program이 `Application.repository`를 타고 정체 칸(`githubRepositoryId`·`nameWithOwner`·`url`)을 select 하는 것은 허용한다.
관측 상태(`visibility`·`presence`·`nextRunAt`·`failureCount`)와 `contribution`은 port로만 읽는다.

이 규칙은 리뷰에서 한 줄로 줄어든다.

> `RepositoryRef`에 칸이 늘었는가.

늘었다면 관측 상태가 필요해졌다는 뜻이고, 그건 port를 써야 한다는 신호다.
"join 했는가"를 보는 것보다 지키기 쉽다.

공개/내부 read repository를 **타입으로** 분리한 것이 핵심이다.
`docs/rules/security.md`의 전용 공개 쿼리 repository 요구가 이것으로 충족되고, 공개 경로에서 일 단위나 실명을 뽑는 코드는 컴파일 단계에서 막힌다.
불리언 플래그로 보안 경계를 표현하면 언젠가 잊는다.

## R3 · R7b — 읽기 포트와 날짜 축

읽기 포트는 3개로 접힌다.

```
controller   HTTP DTO만. 도메인 모름
service      요청 → 도메인 질의 타입 번역 + eligibility + 공개 필드 allowlist
repository   타입된 도메인 질의를 받아 명시적 select로 집계
```

R11~R14로 컨텍스트를 세우고 나면 밖에서 실제로 필요한 것이 이만큼으로 줄어든다.

| 소비자 | 필요한 GitHub 사실 | 해결 |
| --- | --- | --- |
| `ranking` | 기여 집계 | 컨텍스트 안으로 흡수. port 불필요 |
| `program-overview` | 프로그램별 저장소 수 | `Application` 카운트로 대체. port 불필요 |
| `programs` | `githubRepositoryId` | 정체 칸. join 허용 |
| `submission-reviews` | `visibility` + `provisionJob.status` | `findPublishState` |
| `system-status` | 실패 job 수 · 큐 지연 | `health` |

`aggregate` · `findPublishState` · `health` 셋이다.

지금 이 쿼리들이 저장소 테이블에서 시작하는 이유는 `programId`가 거기 있었기 때문이다.

```
findProgramRepositories   githubRepositoryId 1칸 + application.applicant/team/members 전부
findPublishEligibility    visibility 1칸 + application.provisionJob/program/submissions 전부
```

GitHub 사실은 각각 한 칸이고 나머지는 전부 program 컨텍스트 데이터다 — 시작점이 틀렸다.
R9로 `programId`를 저장소에서 빼면 그 길이 막히고, 쿼리는 `Application`에서 시작하게 된다.

security.md가 금지하는 것은 "요청 입력으로 구성되는 query"이지 타입된 도메인 질의가 아니다.
지금 포트가 10개인 이유는 번역 계층이 없어 표면마다 전용 메서드를 뚫었기 때문이다.

날짜 축은 같은 질의로 총합과 시계열을 모두 준다.

```
groupBy: ['contributor']           → 총합    (랭킹)
groupBy: ['contributor', 'week']   → 시계열  (활성화 흐름)
```

다만 총량 공개와 시계열 공개는 다른 정보를 준다.
랭킹은 "얼마나 기여했나"에 답하지만 일 단위 시계열은 "언제 활동하나"에 답한다 — 작업 시간대·주말 여부·중단 구간이 드러난다.

저장 단위와 노출 단위를 분리해 닫는다.

| 경로 | 버킷 | 근거 |
| --- | --- | --- |
| 공개 `/ranking` | 월 | 비인증. 흐름은 보이고 생활 패턴은 안 드러남 |
| 프로그램 내부 | 주 | 인증된 맥락. 지도 목적이 명확함 |

## R5 — 관리 API는 하나다

"스케줄러가 성공했는가"는 답할 수 없는 질문이다.
지금 성공 로그 한 줄에 판정값이 넷 있고(`syncStatus`·`inventoryComplete`·`cycleCompleted`·`stoppedForBudget`), `completed`로 찍히면서 `inventoryComplete: false`일 수 있다.

하나의 boolean으로 배치 전체의 건강을 표현하려 하면 그 boolean은 양방향으로 거짓말한다.
100개 중 1개가 실패해도 실패로, 30개를 건너뛰어도 성공으로 찍힌다.

큐 모델에서는 항목이 자기 상태를 들고 있으므로 지표가 항목 단위로 나온다.

| 지표 | 계산 | 답하는 질문 |
| --- | --- | --- |
| `lastTickAt` | 마지막 cron 실행 | 프로세스가 살아 있나 (liveness) |
| `maxStalenessMinutes` | `now - min(lastSuccessAt)` | 데이터가 얼마나 낡았나 (freshness) |
| `overdueCount` | `count(nextRunAt < now)` | 큐가 밀리나 |
| `failingCount` | `count(failureCount > 0)` | 계속 실패하는 저장소가 있나 |

liveness와 freshness는 다른 질문이고 지금 코드는 둘을 한 줄에 섞어 놨다.
건강 지표는 운영자가 임계값을 걸 수 있는 하나의 숫자여야 한다 — 해석이 필요한 신호는 새벽에 아무도 보지 않는다.

수동 trigger는 두지 않는다.
큐 모델에서 수동 개입은 자동 복구와 경쟁한다 — backoff를 무효화해 실패 중인 저장소를 계속 두드리게 된다.

## 귀속 신호 — commit은 1차 신호가 아니다

ADR-006 §저장·폐기 field inventory가 이미 판정해 둔 사실인데 구현에 반영돼 있지 않다.
commit 응답의 `author`(GitHub 계정 매핑)는 커밋에 쓰인 이메일이 그 계정에 등록돼 있을 때만 채워진다.
우리는 commit author email을 저장하지 않으므로(그리고 이메일 추측 매칭은 field inventory 위반이므로), 이메일 미등록 학생의 commit은 **어떤 사람에게도 귀속되지 않는다.**
PR·release는 항상 계정 기반이라 귀속이 always-on이다.

ADR-006의 결론은 "PR·release를 1차 attribution 신호로, commit을 보조 신호로 삼는다"인데, 현재 랭킹은 셋을 동등 가중한다.
이는 기록된 결정과 어긋나며 동시에 랭킹이 비어 보이는 원인 후보이기도 하다.

가중치는 별도 결정이지만, 최소한 "commit은 불완전한 신호"라는 사실이 드러나야 하고 학생에게 이메일 등록 안내가 필요하다.

## 사라지는 것

| 대상 | 근거 |
| --- | --- |
| `CollectionRun` · `GithubRawObservation` | 이전 세대 |
| `Canonical*` 8장 | 이전 세대 |
| `CollectionCommitFact` · `CollectionPullRequestFact` · `CollectionReleaseFact` | R2 — 재계산이 대체 |
| `CollectionRepositoryYearAggregate` · `CollectionContributorYearAggregate` | D1 — 입자 교체 |
| `CollectionRepositoryStream` | frontier 불필요 |
| `CollectionSyncCursor` · `CollectionSyncLease` · `CollectionCutoverLease` | 큐가 대체 |
| `Repository` | `GithubRepository`로 병합 |
| `collection-discovery.client.ts` (349줄) | R10b — 조직을 훑지 않는다 |
| `repositories/github-app.client.ts` · `github-app.token.ts` (448줄) | R10 — 연결 소유권 이전 |
| `CollectionReadPort` 죽은 메서드 3개 | 호출자 없음 |
| `POST admin/collection/trigger` · `GET runs` · `POST discover-external` | R5 |
| `RankingService`의 60초 캐시 · single-flight · `UserDisplayNameRepository` | D2 · D3 |
| `onlyTeamAuthored`의 팀 특정 분기 | D4 |
| `seoulYearBoundsUtc` 기반 연 경계 재계산 | D1 |
| login rename tie-break | D1 · D4 — `User.nickname`이 원본 |

## 문서 충돌 — 먼저 정리해야 하는 것

**`docs/rules/security.md` §랭킹 표시명 실명 예외가 D3와 정면으로 충돌한다.**

해당 절은 공개 랭킹의 가입자 표시명에 한해 실명 노출을 허용한다고 적혀 있다.
D3는 이 결정을 뒤집는다.
그런데 코드는 이미 D3를 구현한 상태다 — `RankingService.buildEntries`가 `displayName`을 항상 `githubLogin`으로 둔다.
즉 규칙 문서만 옛 결정에 남아 있고, 지금 repo 안에서 규칙과 구현이 어긋나 있다.

같은 절의 "미가입 org 기여자는 `githubLogin`과 미가입 표시로 구분한다"도 D4가 없앤다 — 미가입자는 랭킹에 등장하지 않으므로 구분할 대상이 사라진다.

미해결로 걸려 있던 [#554](https://github.com/JNU-SWCU/oss-hub/issues/554)도 D3·D4가 표면을 크게 줄인다.
공개되는 것이 가입자의 GitHub login뿐이면 동의 표면이 실명 공개와 같지 않다 — 종결 여부는 별도 판단이다.

ADR-006도 §214에서 D3를 "미구현"으로 적고 있어 같은 이유로 낡았다.

`ranking` 도메인은 `prCount`, 스키마는 `pullRequestCount`를 쓴다 — 계층을 넘을 때마다 이름이 바뀌면 매핑 버그가 난다. 한쪽으로 통일한다.

## DDD 관점 대조 (Ontologist)

설계를 DDD 구성요소에 그대로 대봤을 때 어긋난 곳과, 의식적으로 어긴 곳을 남긴다.

### 이미 맞았던 것

R8(재계산 단위 = 저장소)은 "한 트랜잭션에 하나의 aggregate"를 MECE로 재발견한 것이다.
R10b(조건절 없이 행의 존재)는 Specification을 데이터로 승격한 것이다.
R14의 `RepositoryRef`는 Anticorruption Layer의 축소판이다.

### 어긋난 것

**Ubiquitous Language.** `total = commit + pr + release`가 코드에만 있고 근거 문서가 없었다 — D7·D7b로 닫는다.
가중치가 없으므로 그 수치는 점수가 아니라 횟수이며, 이름과 화면 문구가 모두 그렇게 바뀐다.

**Context Map** — D9로 닫혔다. github ↔ identity는 Customer/Supplier다.

```ts
// identity가 제공. 스윕당 한 번 호출한다
listRegisteredGithubIds(): Promise<Set<bigint>>
```

행마다 묻지 않는다 — 저장소 하나에 기여자가 20명이면 스윕 전체로 곱해져 N+1이 된다.

실패 시 동작이 이 결정의 본체다(D9b).
"일단 적재하고 나중에 거른다"를 택하면 실패한 그 순간 미가입자 기여가 DB에 들어간다.
D4의 근거는 성능이 아니라 동의 없는 개인 추적을 만들지 않는 것이고, 한 번 들어간 개인 데이터는 지워도 들어갔던 사실이 남는다.

수집 지연은 되돌릴 수 있고 개인 데이터 유입은 되돌릴 수 없다 — 되돌릴 수 있는 쪽으로 실패하게 만든다.

**작업 영역은 셋이되 깊이가 다르다**(R20).

| 영역 | 무엇을 하는가 | 깊이 |
| --- | --- | --- |
| `github/` | 컨텍스트를 새로 세운다. collection·repositories·public-projects 흡수, 큐 전환, 테이블 20→2 | 전면 |
| `ranking/` | 폴더 유지. `repository/` 없음, 캐시 제거, `total`→`activityCount` | 얕음 |
| `program/` | 구조는 건드리지 않는다. R9로 깨지는 쿼리 4개만 `Application` 시작으로 고치고 `RepositoryRef` 도입 | 표면만 |

**계층 이름이 거짓말한다.** 읽기 쪽은 aggregate 입출력이 아니라 GROUP BY 집계이므로 Repository가 아니다(R18).
설계는 이미 CQRS다 — 쓰기는 Aggregate + Repository, 읽기는 Query Service가 SQL로 직행한다.

**Domain Event가 없다.** `outboxEvent` 테이블을 `applications`·`repositories`가 이미 쓰고 있는데 이 설계는 쓰지 않는다.
R2의 "델타를 로그로 남긴다"는 로그가 아니라 이벤트여야 한다 — 로그는 사람이 읽고 말지만 이벤트는 다른 컨텍스트가 반응할 수 있다.
port만 있으면 상태 변화를 알기 위해 남이 물어봐야 한다(폴링).

```
ContributionRecalculated(repositoryId, delta)   상류 이력이 바뀌었다
RepositoryArchived(repositoryId)                더 이상 수집하지 않는다
CollectionRepeatedlyFailing(repositoryId, n)    notifications가 반응할 수 있다
```

**원시 타입 집착.** `date`의 "Asia/Seoul 기준" 규칙이 주석에만 있다(R19).
이 도메인의 전형적 버그가 날짜 경계 해석이 코드마다 갈리는 것인데, 지금 그걸 막는 것이 문장 하나다.

### 의식적으로 어긴 것

Vaughn Vernon은 aggregate를 작게 유지하라고 한다.
`Repository` aggregate는 5년치면 `Contribution` 행이 수천 개라 교과서상 크다.

그러나 `Contribution`을 별도 aggregate로 떼면 재계산이 aggregate 경계를 넘고 eventual consistency가 필요해진다.
재계산의 원자성이 R2의 자가교정을 성립시키는 근거이므로 이 규모에서는 순손해다.

의도한 이탈이라고 여기 적어 둔다 — 적지 않으면 다음 사람이 교과서를 근거로 쪼갠다.

## 열린 질문

**Q2. 프로그램 표면에서 팀원이지만 기여가 0인 사람을 어떻게 보이는가.**

`Contribution`은 활동이 있는 날에만 행을 만들므로 기여 0인 팀원은 조회 결과에 없다.
교직원 화면이 "팀 명단 전체 + 기여 0"을 보여야 한다면 `TeamMember`를 기준으로 left join해야 하며, 이건 읽기 표면의 책임으로 둔다.

**Q4. 백엔드 모듈 27개가 적정한가.** — R11~R14로 닫혔다.

개수가 아니라 접근 경로가 문제였다.
이번 scope에서는 `github/` 하나만 컨텍스트로 세우고 나머지 셋(identity · program · platform)은 손대지 않는다.

**Q5. 나머지 세 컨텍스트를 언제 세우는가.**

`github/`가 템플릿이 된다 — 같은 네 가지(aggregate root · 소유 테이블 · port · 참조 방향)를 정하는 작업을 컨텍스트마다 반복한다.
`application`을 7개 모듈이 직접 만지는 문제는 program 컨텍스트 차례에 다뤄야 하며, 이번 scope에서는 열어 두기만 한다.

## PR 분할

PR은 작게 쪼개되 원자성 단위는 쪼개지 않는다.
쪼개면 안 되는 것은 그 PR이 머지된 직후 시스템이 유효하지 않은 상태가 되는 변경이고, D13의 계약 변경이 유일한 그런 경우다.

| # | PR | 머지 후 상태 |
| --- | --- | --- |
| A1 | `security.md` 실명 예외 철회 + ADR-006 §214 정정 | 코드 0줄 |
| A2 | `collection/` 소유자에게 구조 변경 제안 Issue | — |
| A3 | `Program.startAt`·`Milestone.startAt` 도입 제안 Issue (`programs/` 소관, R26/D20) | — |
| F1 | `collection/` → `github/` **순수 이동** | 동작 동일 |
| F2 | `repositories/` → `github/` **순수 이동** | 동작 동일 |
| F5 | `program-overview/` → `programs/` **순수 이동** (D23) | 경로·동작 동일 |
| B1 | 가입자 필터를 적재 시점으로 일원화 (#682) | 미가입자 적재 중단 |
| B2 | `Contribution` 테이블 + 마이그레이션만 | 아무도 안 씀 |
| B3 | 백필 + admin parity 리포트 | 읽기 무변경 — D14 게이트 |
| C1 | `Application.repositoryId` 추가(nullable) + 백필 | `programId`도 살아 있음 |
| C2 | 깨지는 쿼리 4개를 `application` 시작으로 전환 | 둘 다 유효 |
| C3 | `programs/domain/repository-ref.ts` 도입 | |
| C4 | `Repository` → `GithubRepository` 병합, `programId`·`teamId` 드롭 | |
| D1 | 랭킹 SQL 집계 + 캐시 제거 + **프론트 동시**(D13) | |
| D2 | 공개/내부 query 분리 (R18) | |
| D3 | 프로그램 기간별·시계열 표면 | 신규 기능 |
| E1 | `nextRunAt` 큐 전환 (리스·커서 제거) | |
| E2 | 실패 유형 분류 + 격리 (R21/R22) | |
| E3 | `system-status`에 D10 지표 + admin guard | |
| F3 | `public-projects/` → `archive/` + 경로 `/archive` + **프론트 동시**(D13) | 계약 변경 |
| F4 | `public-eligibility/` → `archive/` 안으로 흡수 | 동작 동일 |
| G1 | 죽은 테이블 드롭 · old writer 제거 | |
| G2 | `showcase/` 모듈 + `PublicShowcase*` 테이블 2장 드롭 (D16) | 0단계 확인 후 |
| G3 | 경계 lint 3·5번 패턴 + `domain/` 순도 규칙 + archive→programs 단방향 (D19/R28b/D24) | 마지막 — 최종 구조에만 건다 |

**파일 이동과 로직 변경은 같은 PR에 담지 않는다.**
섞으면 git이 rename을 인식하지 못해 diff가 "전부 삭제 + 전부 추가"로 보이고 리뷰가 불가능해진다.
이동을 뒤로 미루면 그 사이 쌓인 모든 변경이 이동 대상이 되므로 껍데기를 먼저 옮긴다 — 이후 모든 작업이 최종 위치에서 일어난다.

C를 넷으로 쪼갠 것도 같은 원리다.
C1~C3 동안 `programId`와 `Application.repositoryId`가 공존하므로 어느 시점에 멈춰도 시스템은 유효하다.

## 실행 순서

### 0. 왜 지금 비어 있는지부터 판정한다

재설계는 "랭킹이 비었다"를 자동으로 고치지 않는다.
원인이 아래 어느 것인지 모르면 고친 뒤에도 비어 있을 수 있으므로, 코드를 건드리기 전에 판정한다.

| 후보 | 구분 신호 |
| --- | --- |
| cron이 안 돈다 | `collection.scheduler.*` 로그가 아예 없다 |
| 리스가 잡혀 있다 | `syncStatus: SKIPPED_LEASE_HELD`가 반복된다 |
| 한 저장소가 사이클을 막는다 | `cycleCompleted: false`가 지속된다 |
| 인벤토리가 영구 partial | `inventoryComplete: false`인데 로그는 성공으로 보인다 — 가장 조용한 실패 |
| 공개 필터가 전부 걷어낸다 | 집계 행은 있는데 `visibility=PUBLIC ∧ presence=PRESENT` join이 0 |
| 귀속이 비어 있다 | fact 행은 있는데 `authorGithubId`가 null (이메일 미등록) |
| 프런트 스키마 불일치 | `curl`은 데이터를 주는데 화면만 빈다 |

마지막 두 개는 이번 재설계가 새로 드러낸 후보다.
특히 `authorGithubId` null 비율은 지금까지 아무도 보지 않던 수치인데, 높다면 파이프라인이 아니라 안내의 문제다.

### 1. 문서와 거버넌스를 먼저 맞춘다 (선행, 저비용)

`docs/rules/security.md` §랭킹 표시명 실명 예외를 D3에 맞게 개정하고, 같은 절의 미가입 표시 문장을 D4에 맞게 정리한다.
ADR-006 §214의 "D3 미구현" 서술을 갱신한다.
`collection/` 소유자에게 구조 변경을 Issue로 제안한다.

### 2. 가입자 필터를 적재 시점으로 일원화한다 (#682 종결)

`onlyTeamAuthored`의 팀 특정 분기를 `authorGithubId ∈ 가입자` 단일 규칙으로 바꾼다.
스키마 변경이 없으므로 먼저 넣을 수 있고, 넣는 즉시 랭킹의 의미가 정해진다.

### 3. `Contribution`을 넣고 기존 fact에서 백필한다

fact 행에 `authorGithubId`와 발생 시각이 모두 있으므로 재구성이 가능하다.
fact 테이블은 이 단계에서 지우지 않고 병행시킨다 — 백필의 원천이자 D8의 대조군이기 때문이다.

**D8 — 전환 수용 기준.**
백필 직후 `(사람, 연도) → commit·PR·release` 세 수치를 `CollectionContributorYearAggregate`와 비교한다.
누적이므로 같은 기간 같은 사람의 값은 같아야 하며 허용 오차는 0이다.
응답 JSON을 비교하지 않는다 — D7b로 `total`이 `activityCount`가 되고 화면 문구도 바뀌므로 봉투는 달라진다(R1).

parity는 기존 집계가 옳다는 전제 위에서만 성립하므로 0단계 결론에 조건부다.

| 0단계 결론 | parity |
| --- | --- |
| cron 미실행 · 리스 점유 | 유효 — 집계 로직은 맞고 실행이 안 됐다 |
| 공개 필터가 걷어냄 | 유효 — 적재는 맞고 조회가 걸렀다 |
| `authorGithubId` null | **무효** — 귀속이 틀렸으면 기존 집계 자체가 틀렸다 |

마지막이면 골든 저장소 셋(3~5개를 GitHub에서 직접 조회해 정답 생성)으로 갈아탄다.

재계산 멱등성 테스트는 별건으로 남긴다 — 같은 저장소를 연속 재계산해 결과가 동일함을 고정한다.
이것은 전환 검증이 아니라 R2 자가교정의 전제이므로 회귀 방지용 상설 테스트다.

**D14 — parity는 배포 전에 잰다(shadow).**
이 단계는 `Contribution`을 채우기만 하고 읽기 경로는 손대지 않는다.
대조는 admin 전용 parity 리포트로 돌리고, 불일치 0을 확인한 뒤에야 5단계(읽기 전환)로 넘어간다.
롤백 절차를 따로 설계하지 않는 이유는 여기 있다 — 틀린 숫자가 화면에 나간 적이 없으면 되돌릴 것도 없다.
코드는 revert할 수 있지만 "랭킹 숫자가 한 번 이상했다"는 기억은 revert되지 않는다(D9b와 같은 원리).

### 4. 저장소 엔티티를 병합한다

`Repository` → `GithubRepository` 병합, `programId`·`teamId` 제거, `Application.repositoryId` 도입.
`RepositoryInvitation`·`RepositoryProvisionJob`·`PublicShowcaseRepository`의 참조를 같이 옮긴다.

`programId`가 사라지므로 밖에서 저장소를 뒤지던 쿼리 넷이 이 단계에서 깨진다 — 같이 옮긴다.

| 지금 | 이후 |
| --- | --- |
| `repository.count({ where: { programId } })` | `application.count({ where: { programId, repositoryId: { not: null } } })` |
| `repository.findMany({ where: { programId }, ... })` | `application.findMany({ where: { programId }, select: { repository: { select: 정체 칸 } } })` |
| `repository.findUnique` + `visibility` | `application` 시작 + `findPublishState` port |
| `repositoryProvisionJob.count` | `health` port |

`programs/domain/repository-ref.ts`를 이 단계에서 만든다 — 이후 경계 감시는 이 타입의 칸 수로 한다.

### 5. 읽기를 옮긴다

4단계 shadow parity가 0으로 확인된 뒤에만 진입한다(D14).

랭킹을 `Contribution` 위의 SQL 집계로 교체하고 캐시·single-flight·`UserDisplayNameRepository`를 제거한다.
공개/내부 read query를 타입으로 분리한다(R18).
프로그램 표면(기간별·시계열)이 이 단계에서 처음으로 가능해진다.

`total` → `activityCount` 로 봉투가 바뀌므로 `apps/frontend/src/features/ranking/` 을 같은 PR에 담는다(D13).
화면 문구 "점수"도 "활동 횟수"로 함께 고친다(D7b) — 봉투만 바꾸고 문구를 두면 가중치가 없는데 점수라 부르는 상태가 남는다.

### 6. 큐와 `github/` 컨텍스트로 전환한다

`nextRunAt`·`lastSuccessAt`·`failureCount` 도입, lease/cursor 제거, discovery 제거.
App 클라이언트를 하나로 합친다 — `repositories/`는 이 단계에서 `github/`로 흡수되므로 주입 대상이 아니라 같은 컨텍스트 안이 된다.
`ranking/`·`public-projects/` 를 `github/api/` 로 옮기고 폴더를 없앤다(R13).
`system-status`를 새 지표로 교체하고 admin endpoint 셋을 제거한다.

### 7. 죽은 테이블과 코드를 드롭한다

호출자가 전부 옮겨진 뒤에만 드롭한다.

순서의 근거: 0은 나머지 전부의 전제이고, 1·2는 스키마 없이 의미를 먼저 확정하며, 3~7은 그 확정된 의미를 담을 그릇을 바꾼다.
2를 3보다 뒤에 두면 잘못된 모집단을 새 테이블에 그대로 백필하게 된다.
3의 백필이 끝나기 전에 7을 하면 원천을 잃는다.
