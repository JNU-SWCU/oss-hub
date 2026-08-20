# TEAM-STATE — 멤버 저널 인덱스

진행 상태의 원본은 GitHub Issue·PR이다.
이 파일은 인덱스만 두고, 작업 기록은 작성자 저널에만 남긴다.
쓰기 규칙은 루트 [AGENTS.md](../../AGENTS.md) §3이 원본이다.

| 작성자 | 저널 |
| --- | --- |
| @GoBeromsu | [team-state/GoBeromsu.md](team-state/GoBeromsu.md) |
| @Lumiere001 | [team-state/Lumiere001.md](team-state/Lumiere001.md) |
| @Geuin04 | [team-state/Geuin04.md](team-state/Geuin04.md) |
| @jinsol1190-rgb | [team-state/jinsol1190-rgb.md](team-state/jinsol1190-rgb.md) |

없는 핸들은 `docs/handoff/team-state/<핸들>.md`를 새로 만든다.
2026-08-20 이전 공유 스냅샷은 [TEAM-STATE.archive.md](TEAM-STATE.archive.md)에 동결돼 있고 더 이상 고치지 않는다.

## 항목 형식

자기 저널 **맨 끝**에만 붙인다. 옛 항목은 고치지 않는다.

```markdown
## 2026-08-20 — 짧은 제목

- 상태: review
- Issue: -
- PR: (이 PR)
- blocker: 없음
```

`상태`는 `planned` / `active` / `blocked` / `review` / `done`이다.
같은 기능의 상태 전이는 행을 고치지 않고 새 항목을 붙인다. 현재 상태는 같은 Issue·PR(없으면 제목)의 마지막 항목이다.
