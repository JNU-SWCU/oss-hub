# e2e 404 flake — 조사 인수인계

> **이 문서는 미완결 조사의 인계장이다.** 원인은 아직 특정되지 않았다.
> 2026-08-07 시점에 확인된 사실과, 다음 세션이 어디서부터 이어 붙이면 되는지를 적는다.
> 팀 상태 기록은 [TEAM-STATE.md](TEAM-STATE.md) 인덱스가 가리키는 작성자 저널이 원본이다.
> 이 문서가 가리키던 옛 표 행은 [TEAM-STATE.archive.md](TEAM-STATE.archive.md)에 동결돼 있다.

## 메타

| 항목 | 값 |
| --- | --- |
| 최초 발생 | 2026-08-07 main push CI `c7bac95f` |
| 증상 | `admin-session.fixture.ts`의 `expect(consoleErrors).toEqual([])` 실패 |
| 재실행 | 통과 — **flake 확정** |
| 현재 상태 | 원인 미상. 계측만 완료(이 PR) |
| 다음 트리거 | 같은 실패가 재발할 때. 그때는 URL이 로그에 남는다 |

## 1. 무슨 일이 있었나

main push CI가 브라우저 회귀에서 실패했다. fixture가 모아 둔 콘솔 오류에
다음 한 줄이 들어 있었다.

```
Failed to load resource: the server responded with a status of 404 (Not Found)
```

**어떤 URL이 404였는지 알 방법이 없었다.** 재실행으로 통과해 flake로 확정했지만,
원인을 좁히지 못한 채 닫혔고 조사에 상당한 시간이 들었다.

## 2. 왜 URL을 알 수 없었나 — 막혀 있던 세 경로

1. **Chrome 콘솔 메시지 본문에 URL이 없다.** 그 문자열은 status만 담는다.
   fixture는 `message.text()`만 저장하므로 남는 정보가 그게 전부였다.
2. **`next dev`의 요청 로그가 버려졌다.** `playwright.config.ts`의 `webServer`에
   `stdout` 설정이 없어 Playwright 기본값 `stdout: 'ignore'`로 통째로 폐기됐다.
   서버 쪽에는 `GET ... 404`가 분명히 찍혔을 텐데 아무 데도 남지 않았다.
3. **trace는 공개 artifact에 올라가지 않는다.** trace에는 네트워크 전량이 있지만
   CI 업로드(`.github/workflows/ci.yml`)는 `**/public-evidence-*.png`만 올린다.
   이는 **의도된 결정**이다 — 자동 실패 screenshot·video·trace는 마스킹을 거치지
   않으므로 공개 artifact에서 제외한다. ⚠ **그냥 풀면 안 된다.**

## 3. 이번에 한 것 (계측만)

3번은 건드리지 않고 1·2번만 열었다.

- `admin-session.fixture.ts` — `page.on('response')`로 4xx·5xx의 `url`·`status`를
  모아 두었다가 단언 실패 메시지에 붙인다.
- `playwright.config.ts` — `webServer.stdout: 'pipe'`로 dev 서버 요청 로그를 살린다.

404를 주입한 실측에서 양쪽 모두 남는 것을 확인했다.

```
Error: browser console and page errors
이 세션에서 실패한 응답:
  - 404 http://127.0.0.1:64818/__probe-missing-asset.png
```

```
[WebServer]  GET /__probe-missing-asset.png 404 in 462ms
```

⚠ **이 목록은 진단 전용이며 이것으로 단언하지 않는다.** lifecycle 스펙은 권한
거부(403)와 낙관적 잠금 충돌(409)을 의도적으로 만들어 검증하므로, 정상 통과
실행에도 4xx가 들어 있다. 판정은 콘솔 오류가 계속 맡는다.

## 4. 아직 모르는 것 — 다음 세션이 풀 문제

**어떤 URL이 404였는지.** 후보는 좁혀졌지만 특정되지 않았다.

확인된 배제 근거:

- `/admin/access` 앱 코드에는 404를 낼 요청이 없다 — `<img>`·`next/image`·CSS
  `url()`·svg/png 참조 0건, 사이드바 패싯 fetch도 돌지 않는다.
- `/icon.svg`는 **정상 실행에서 200이다.** 이번에 살린 dev 서버 로그로 확인했다
  (`GET /icon.svg?1c8a4fd8b6732a20 200`). 후보에서 한 칸 좁혔다 — 다만 *정상*
  실행에서 200이라는 것이지, 온디맨드 컴파일 경합 중에도 200이라는 뜻은 아니다.

남은 후보는 `next dev` 인프라 리소스로 **추정되나 확인되지 않았다**:
온디맨드 청크, 폰트, HMR 엔드포인트. 정상 실행 로그에서도
`○ Compiling /_not-found ...`·`○ Compiling /programs/[id] ...`처럼 온디맨드
컴파일이 실제로 일어나는 것이 보인다.

### ⚠ 원인 미상 404를 allowlist로 덮지 말 것

`expectedResourceStatuses`에 404를 넣어 통과시키고 싶은 유혹이 있는데, 그러면
**진짜 앱 버그로 생긴 404까지 같이 눈감게 된다.** 순서는 이렇다.

1. 재발할 때까지 기다린다 (이제 URL이 남는다).
2. 잡힌 URL을 확인한다.
3. **그 URL만** 좁게 예외 처리한다.

## 5. `retries: 1`을 넣지 않은 이유 — 실측 기록

flake 대응으로 `retries: 1`이 검토됐고 실제로 넣어 돌려 봤다. **효과가 없어
되돌렸다.** 근거는 `playwright.config.ts` 주석에도 남겼다.

Playwright는 재시도 때 `webServer`를 재기동하지 않는다. DB가 앞 시도의 변경을
그대로 안고 간다. 그런데 lifecycle 스펙은 `describe.serial`이라 재시도는 1번부터
다시 도는데, 1번은

- `요청함 (2)` — PENDING **개수**를 단언하고,
- 그 PENDING 중 하나를 **승인해 버린다**.

그래서 재시도 시점에는 PENDING이 1건뿐이라 `요청함 (2)` 버튼을 영영 기다린다.

teardown만 실패하도록 404를 주입해(= 실제 CI flake와 같은 모양: 본문 통과 →
teardown 실패) 실측한 결과:

| | 결과 |
| --- | --- |
| 1차 시도 | 진짜 원인 보임 — `- 404 http://127.0.0.1:65070/__simulated-flake.png` |
| 재시도 #1 | **45.1초 timeout 후 실패** — `waiting for getByRole('button', { name: /요청함 \(2\)/ })` |
| 최종 | `1 failed` + **`4 did not run`** |

넣지 않기로 한 이유 셋:

1. **실패가 그대로다.** 재시도 명분이 "1번이 죽으면 나머지 4개가 아예 안 돈다"
   였는데, 재시도해도 나머지 4개는 여전히 `did not run`이다. 명분이 해소되지 않는다.
2. **진짜 원인을 덮는다.** 로그 맨 아래에 남는 마지막 오류가 `요청함 (2)`
   타임아웃으로 바뀐다. 다음 조사자가 로그 끝부터 읽으면 엉뚱한 곳으로 간다 —
   이번에 겪은 것과 같은 시간 낭비를 한 번 더 만든다.
3. **CI 시간만 45초 늘어난다.**

**재시도가 의미를 가지려면 시도 사이에 시드를 되돌리는 설계가 선행돼야 한다.**
그게 없는 상태의 `retries` 인상은 순손실이다.

## 6. 별건으로 남은 더 큰 개선

### 6-1. e2e를 `next build && next start`로 전환

지금 e2e는 `next dev`로 돈다(`e2e/run-stack.sh`). 온디맨드 컴파일·HMR·dev
오버레이가 flake의 원천이고, 이번 404도 그 계열로 추정된다. `next build &&
next start`로 바꾸면 원천이 사라지고 **배포되는 것과 같은 산출물**을 검증하게
된다.

선행 과제:

- 빌드 시간 증가를 CI 예산 안에서 감당할 수 있는지.
- dev 전용 rewrite 대체 설계 — `next.config.ts`의 `NODE_ENV !== 'development'`
  분기가 production 모드에서 다르게 동작한다.

⚠ **이 조사에 섞지 말 것.** 별도 티켓으로 다룬다.

### 6-2. 재시도를 위한 시드 복원

5절 참조. 시도 사이 DB 복원이 있어야 `retries`가 의미를 갖는다.

## 7. 다음 세션 시작 방법

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24
pnpm --filter frontend e2e
```

- 전체 스택(docker postgres + backend + `next dev`)이 자동으로 뜨고 8개가 돈다.
  로컬 정상 실행은 약 1.1~1.3분이다.
- 특정 스펙만: `pnpm --filter frontend e2e -- admin-access-lifecycle`
- 이제 dev 서버 로그가 `[WebServer]` 접두로 함께 출력된다. 404를 여기서 바로
  읽을 수 있다.
- 재발 시 확인할 곳: 실패 단언 메시지의 `이 세션에서 실패한 응답:` 블록.

## 🔗 관련 문서

- [TEAM-STATE.archive.md](TEAM-STATE.archive.md) — 이 조사가 적혀 있던 옛 표 행
- [team-state-drift-check.md](team-state-drift-check.md) — pre-push 훅 우회 절차
