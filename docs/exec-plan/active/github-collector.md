# exec-plan: GitHub 활동 수집기 (collection)

- owner: @Lumiere001 / Issue: #10 / 브랜치: `feat/github-collector`
- 상태: review (2026-07-15)

## 목표

로그인 사용자의 공개 GitHub 프로필·repository·event를 run 단위 원본 관측으로 수집한다.
SELF HTTP 요청과 운영 batch CLI가 같은 수집 usecase를 사용하며, 사용자 토큰은 사용하지 않는다.

## 범위

- In: backend `collection` 모듈, run·raw observation 스키마, SELF endpoint, batch CLI
- Out: 사용자 토큰 저장·사용, private GitHub 데이터, inline 재시도, 최신 상태 projection, GitHub App 인증

## 설계 결정

1. OAuth App `client_id:client_secret` Basic 자격만 사용한다. `GITHUB_COLLECTOR_TOKEN`이 존재하면
   unsupported configuration으로 시작을 거부하며 값은 응답·로그에 남기지 않는다.
2. run을 `RUNNING`으로 만든 뒤 외부 HTTP를 트랜잭션 밖에서 순차 실행한다. 세 소스가 모두
   성공한 뒤 raw observation 저장과 count·`SUCCEEDED` 갱신만 짧은 트랜잭션으로 묶는다.
3. primary·secondary rate limit은 inline 재시도하지 않고 `RATE_LIMITED`와
   `retryNotBeforeAt`로 기록한다. 해제 시각은 Retry-After, reset epoch, 60초 fallback 순이다.
4. raw observation은 run 범위에서 append-only이며 `(runId, sourceType, sourceId)`로 중복을 막는다.
   Prisma row·Json 타입은 repository 경계 밖으로 노출하지 않는다.
5. SELF는 세션의 `githubId`로만 대상을 찾는다. batch는 `GITHUB_BATCH_LOGINS` 전체 검증 후
   순차 실행하고, 목록 밖 값이 하나라도 있으면 아무 계정도 실행하지 않는다.
   batch 대상의 신원(githubId)은 **사전 로그인 없이** GitHub 프로필 관측값에서 해석한다 —
   해석 단계의 rate limit은 run 행이 생기기 전이므로 기록 없이 배치를 중단한다.
6. rate-limit HTTP 응답은 `COL_001` ProblemDetail에 ISO `retryNotBeforeAt` 확장 필드를 제공한다.
   일반 upstream 실패는 공개 도메인 오류 메시지 없이 run을 `FAILED`로만 기록한다.
7. 사용자별 수집 시작은 DB transaction 안에서 GitHub ID advisory try-lock과 `RUNNING` partial
   unique index로 원자성을 보장한다. 이미 실행 중이거나 직전 시작 후 60초 이내면 `COL_002`
   (429)와 ISO `retryNotBeforeAt`로 거부한다. 저장된 GitHub rate-limit 해제 시각이 더 늦으면
   그 시각을 우선한다. SELF는 거부를 HTTP 오류로 변환하고, batch는 해당 대상만 건너뛴다.

## 구현 단계

1. [x] `CollectionRun`·`GithubRawObservation` Prisma 모델과 enum 추가
2. [x] GitHub API client·설정·rate-limit·pagination 구현
3. [x] collection repository·service와 SELF controller 구현
4. [x] batch CLI·AppModule·환경 키 연결
5. [x] DB·네트워크 없는 client·config·service 단위테스트 작성
6. [x] lint·typecheck·test 검증
7. [x] 호스트 migration 생성 및 dev/reset 검증
8. [x] 사용자별 병렬·RUNNING·cooldown·DB unique 제약 실DB 회귀 테스트 작성

## 검증

- `pnpm --filter backend lint`
- `pnpm --filter backend typecheck`
- `pnpm --filter backend test`
- collection 통합 테스트가 합성 PostgreSQL을 준비하고 migration deploy 후 원자 gate·제약 검증

## 운영 조건

- `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `GITHUB_BATCH_LOGINS` 실값은 배포
  secret/config store에서만 주입한다.
- batch는 allowlist 전체를 순차 처리하며 rate limit 발생 시 남은 계정을 호출하지 않는다.
- 한도 확장이 필요하면 PAT fallback을 추가하지 않고 GitHub App 인증을 별도 ADR로 결정한다.
