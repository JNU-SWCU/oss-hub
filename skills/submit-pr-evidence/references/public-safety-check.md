# public-safe 검사

PR을 열기 전 변경 파일·커밋 메시지를 검사한다.

```bash
bash scripts/check-public-safe.sh
```

Issue 초안처럼 아직 커밋되지 않은 텍스트(제목·본문·댓글)만 검사하려면 `--text-only` 모드를 쓴다.

```bash
ISSUE_TEXT="$(cat <draft>)" bash scripts/check-public-safe.sh --text-only
```

deny-list 8종과 예외 범위(Git commit identity 이메일 등)의 원본은 [docs/rules/security.md](../../../docs/rules/security.md)다.
이 문서는 목록을 옮겨 적지 않는다 — 원본이 바뀌면 사본이 조용히 갈라진다.
