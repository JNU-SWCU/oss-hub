# apps/backend/prisma — 스키마·마이그레이션 규칙

- **마이그레이션은 직렬로만.** 두 PR이 동시에 마이그레이션을 만들지 않는다
  (원본: 루트 [AGENTS.md](../../../AGENTS.md) §3). 이미 마이그레이션 PR이 열려 있으면
  그 브랜치 위에 stack하고 merge도 같은 순서로 한다.
- 변경 절차: `schema.prisma` 수정 → `pnpm --filter backend db:migrate:dev` →
  생성된 SQL을 직접 확인 → clean DB에 `pnpm --filter backend db:reset`으로 재적용 검증.
  CI는 마이그레이션 SQL의 실제 적용을 검사하지 않으므로 이 로컬 검증이 유일한 게이트다.
- 생성된 마이그레이션 SQL을 손으로 고치지 않는다 — 수정이 필요하면 새 마이그레이션을 만든다.
- 식별자 규칙: 외부 시스템의 숫자 ID(GitHub 등)는 `BigInt`로 저장하고, 변경될 수 있는 값
  (login·닉네임 등)은 unique 키나 FK로 쓰지 않는다.
- 이벤트성 데이터는 append-only — UPDATE 대신 새 row를 쌓고, 원본 payload는 `Json`으로
  보존한다 (수집 원본은 나중에 재계산할 수 있어야 한다).
- seed·마이그레이션·fixture에 실데이터를 넣지 않는다 — 합성 데이터만
  ([security.md](../../../docs/rules/security.md)).
