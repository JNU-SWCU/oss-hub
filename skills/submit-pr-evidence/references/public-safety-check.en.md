# Public-Safe Checks

[한국어](public-safety-check.md) | **English**

English translation of the [Korean source](public-safety-check.md).
The Korean document remains authoritative.

Before opening a PR, check changed files and commit messages.

```bash
bash scripts/check-public-safe.sh
```

For text that has not been committed, such as an Issue draft (title, body, or comment), use `--text-only`.

```bash
ISSUE_TEXT="$(cat <draft>)" bash scripts/check-public-safe.sh --text-only
```

[scripts/check-public-safe.sh](../../../scripts/check-public-safe.sh) owns the eight deny-list categories and exceptions, including Git commit identity emails.
This document does not copy the list: copies silently diverge when the source changes.
