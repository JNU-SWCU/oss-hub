# exec-plan: GitHub OAuth 로그인 (auth)

- owner: @Lumiere001 / Issue: #9 / 브랜치: `feat/github-oauth-login`
- 상태: done — PR #13·#22 merge (2026-07-17 archive)

## 목표

학생이 GitHub 계정으로 플랫폼에 로그인한다. 이 로그인은 본인 확인이자 수집 동의의 관문이다
(공통 PRD Must "학생 GitHub 계정/ID 연결", ADR-001 "OAuth 로그인 전용").

## 범위

- In: backend `auth` 모듈(authorize 진입·callback·세션·me·logout), `User` 스키마, frontend 로그인 버튼
- Out: 학교 SSO(범위에 없음) · 교직원 magic link(후속) · 사용자 토큰 저장(불필요 — 아래) · 역할/권한

## 설계 결정 (검증 근거는 PR 본문)

1. **사용자 액세스 토큰을 저장하지 않는다.** 로그인 토큰은 `GET /user` 신원 확인에 한 번 쓰고 폐기.
   수집은 public 데이터라 App 자격증명으로 충분(수집기 exec-plan 참조). 저장할 토큰이 없으므로
   암호화·회전·유출 표면 자체가 없다.
2. **state + PKCE(S256) 병용.** 무서명 `state.verifier` 쿠키(각 43자 base64url, Max-Age 600,
   운영 `__Host-` 접두사/개발 무접두사, Domain 미설정), callback 진입 즉시 삭제, 상수시간 비교.
   브라우저당 동시 로그인 flow 1개는 의도된 제약.
3. **세션 = `jose` HS256 JWT** (클레임 `sub`(githubId 10진 문자열)/`iss`/`aud`/`iat`/`exp`만, 7일,
   `algorithms:["HS256"]` 고정, 키는 32B+ 난수·시작 시 검증). httpOnly 쿠키, SameSite=Lax,
   운영 Secure. stateless라 로그아웃 = 쿠키 삭제(토큰 즉시 폐기 불가)는 수용된 트레이드오프.
4. **callback 보안:** `code`/`state`를 로그·응답에 남기지 않는다(전역 ProblemDetail 필터가
   originalUrl을 기록하므로 auth 실패는 필터에 태우지 않고 frontend 고정 오류 경로로 redirect).
   `error=access_denied` 분기 처리. redirect_uri·FRONTEND_URL은 시작 시 검증된 고정값.
5. 쓰기 엔드포인트(logout)에 Origin 검사. logout은 `200 {"isAuthenticated": false}`
   (api-client가 2xx JSON을 읽으므로 204 금지).
6. 오류 코드는 4xx만 공개: `AUT_001`(잘못된 OAuth flow, 400) · `AUT_003`(미인증, 401).

## 구현 단계

1. [x] Issue #9 선점 · 설계 확정 (CC↔Codex 교차 토론 2R)
2. [ ] `jose` 추가 (lockfile 재생성) · `.env.example` 키 추가
3. [ ] Prisma `User` 모델 + 마이그레이션 (직렬 규칙 — 이 PR이 유일한 열린 마이그레이션)
4. [ ] auth 모듈: controller(3 endpoint) → service(flow·세션) → repository(User upsert)
5. [ ] frontend: `apiPath()` 빌더 export + `features/auth` 로그인 버튼·`useMe`
6. [ ] 단위테스트: 세션 profile(변조·만료·경계), state/PKCE 검증, service flow(fetch mock)
7. [ ] lint·typecheck·test·build + 마이그레이션 dev/reset 검증 → Draft PR

## 운영 전 조건 (이 PR 밖, 배포 전 필수)

- 외부 TLS 종단 계약 명시 또는 nginx TLS 추가 — 현재 `listen 80`뿐이라 운영 Secure/`__Host-`
  쿠키가 동작하지 않는다. compose에 OAuth env 전달도 필요. → PM과 배포 시점에 확정
