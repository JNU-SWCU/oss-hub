-- 회원 유형·독립 접근 권한의 **bridge** 단계.
--
-- 이 릴리스는 정본(canonical) 애플리케이션 동작을 전부 배포하면서도 물리 스키마를
-- 직전 이미지(v0.6.110 / base 41b101b7)가 그대로 읽고 쓸 수 있는 모양으로 남긴다.
-- 그래서 여기에는 파괴적 DDL이 하나도 없다 —
--
--   * legacy `User.role` · `selectedRole` · `name` · `studentId` · `department`를 지우지 않는다.
--   * `Role` enum을 지우지 않는다.
--   * `RoleRequest` 테이블과 `RoleRequestStatus` 타입을 물리적으로 개명하지 않는다.
--     정본 이름(`StaffAccessRequest`·`StaffAccessRequestStatus`)은 Prisma의 `@@map`이
--     제공한다 — 애플리케이션은 정본 이름으로 말하고 DB는 옛 이름을 그대로 들고 있다.
--
-- 유일하게 손대는 것은 **접근 권한 두 칸의 fail-closed 잠금**이다.
--
-- `hasStaffAccess`·`hasAdminAccess`는 expand 단계에서 nullable로 태어났고, 그 NULL은
-- "권한을 아직 모른다"는 뜻이었다. 정본 코드에는 그 미지 상태를 표현할 자리가 없다 —
-- 권한 판정은 언제나 두 boolean을 각각 보고, 모르는 값은 곧 열림(fail-open)이거나
-- 흩뿌려진 fallback이다. 그래서 legacy 역할에서 한 번 backfill한 뒤 NOT NULL로 잠그고
-- 기본값을 FALSE로 둔다 — 이후 만들어지는 계정은 "권한 없음"에서 시작한다.
--
-- 이 변경이 v0.6.110에 안전한 근거:
--   * v0.6.110의 권한 쓰기 경로(`compareAndSwapAccess`)는 두 칸을 **언제나 명시적으로**
--     함께 쓴다 — NULL을 쓰는 경로가 없다.
--   * v0.6.110의 가입 경로(`user.createMany`)는 두 칸을 생략한다. DEFAULT FALSE가
--     채우며, 그 값은 v0.6.110 자신의 호환 해석기가 `role = NULL`에서 유도하던 값과
--     같다(신규 계정은 권한이 없다).
--   * backfill 값은 v0.6.110의 `resolveMemberAuthorityCompatibility`가 legacy role에서
--     유도하던 값과 정확히 같은 규칙이다 — 그 이미지가 되돌아와도 해석이 바뀌지 않는다.
--
-- `UserProfile.memberKind` · `affiliationKind` · `affiliationName`은 **nullable로 남긴다**.
-- v0.6.110이 새 프로필 행을 만들 때 이 세 칸을 쓰지 않기 때문이다(그 이미지의
-- `profile-compatibility.repository.ts`는 name·studentId·department만 create한다).
-- 여기에 NOT NULL을 걸면 직전 이미지의 가입 완료가 전부 실패한다. 다만 **지금 있는
-- 행은 아래 [3/3]이 채운다**. 애플리케이션은 남는 공백을 전용 헬퍼로 접지 않고
-- 질의·투영 양쪽에서 양성 비교로만 다뤄 저절로 fail-closed된다
-- (`profiles/user-profile-read.ts` 주석).
--
-- **bridge는 `memberKind` NULL이 문자 그대로 0이 된다고 약속하지 않는다.**
-- 배정된 관리자(legacy `role = 'ADMIN'`)는 의도적으로 미해소로 남는다 — 그에게
-- 회원 유형을 지어내지 않는 것이 이 단계의 사양이고, 그 분류는 사람이 명시적으로
-- 해야 한다. bridge가 보장하는 것은 둘이다.
--
--   * 관리자가 아닌 프로필 중 미해소 0건
--   * `hasStaffAccess`·`hasAdminAccess` NULL 0건
--
-- 최종 contract 마이그레이션의 preflight는 여전히 **전체** 0건을 요구한다. 그런증
-- 그 사이에 운영에서 관리자 분류를 끝내는 절차가 따로 서야 한다.
--
-- 되돌리기 — **소스와 배포된 DB를 구분해야 한다.**
--   소스: bridge 커밋들을 revert하면 최종 contract diff가 복원된다.
--   배포된 DB: **복원되지 않는다.** 이 마이그레이션이 한 번 적용되면
--   `_prisma_migrations`에 이 이름으로 행이 남고, 소스에서 파일을 지우는 것으로는
--   그 행이 사라지지 않는다. 그래서 파괴적 단계는 이 파일을 갈아끼우는 게 아니라
--   **더 늦은 별도 마이그레이션**(`20260824000000_contract_member_authority`)으로
--   올라와야 한다. `scripts/prisma-migration-ledger.test.mjs`가 그것을 잠그고 있다.

-- ---------------------------------------------------------------------------
-- [1/3] legacy 역할에서 접근 권한 두 칸을 backfill한다.
--
--       규칙은 v0.6.110의 호환 해석기와 동일하다:
--         ADMIN → 관리자 접근 O, 교직원 접근 O
--         STAFF → 교직원 접근 O
--         그 밖(STUDENT · NULL) → 둘 다 X
--
--       이미 값이 있는 행은 건드리지 않는다(`IS NULL` 조건). 정본 쓰기가 이미
--       확정한 권한을 legacy 역할이 되돌리면 안 된다 — 이 둘이 어긋난 계정이
--       cutover 도중 생길 수 있고, 그때 정본 값이 최신이다.
--
--       `COALESCE`가 없으면 이 마이그레이션은 운영에서 통째로 실패한다.
--       SQL의 3값 논리에서 `NULL IN ('STAFF','ADMIN')`은 FALSE가 아니라 **NULL**이다.
--       역할이 없는 계정(가입 직후·권한 회수 이후)은 `role`이 NULL이라 그대로
--       NULL이 써지고, 아래 [2/3]의 SET NOT NULL이 `contains null values`로
--       터져 트랜잭션 전체가 롤백된다. 빈 테이블에서는 잡힐 수 없는 결함이라
--       업그레이드 레인 리허설이 반드시 행을 먼저 심고 돌려야 한다.
-- ---------------------------------------------------------------------------
UPDATE "User"
SET "hasStaffAccess" = COALESCE(("role" IN ('STAFF', 'ADMIN')), FALSE)
WHERE "hasStaffAccess" IS NULL;

UPDATE "User"
SET "hasAdminAccess" = COALESCE(("role" = 'ADMIN'), FALSE)
WHERE "hasAdminAccess" IS NULL;

-- ---------------------------------------------------------------------------
-- [2/3] 두 칸을 NOT NULL + DEFAULT FALSE로 잠근다.
--
--       DEFAULT가 먼저 서야 한다. v0.6.110의 가입 경로가 두 칸을 생략한 INSERT를
--       보내므로, DEFAULT 없이 NOT NULL만 걸면 직전 이미지에서 가입이 막힌다.
-- ---------------------------------------------------------------------------
ALTER TABLE "User"
  ALTER COLUMN "hasStaffAccess" SET DEFAULT FALSE,
  ALTER COLUMN "hasAdminAccess" SET DEFAULT FALSE;

ALTER TABLE "User"
  ALTER COLUMN "hasStaffAccess" SET NOT NULL,
  ALTER COLUMN "hasAdminAccess" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- [3/3] 정본 프로필 세 칸을 legacy 사실로 backfill한다.
--
--       칸은 nullable로 **남긴다** — v0.6.110이 새 프로필 행을 만들 때 이 세 칸을
--       쓰지 않으므로 NOT NULL을 걸면 그 이미지의 가입이 막힌다. 그러나 **지금
--       존재하는** 행은 legacy 사실이 말해 주는 만큼 채워 둔다. 배정된 관리자는
--       예외다 — 의도적으로 미해소로 남기며(아래 규칙 2) 그 분류는 운영에서
--       명시적으로 한다. 그래서 이 마이그레이션은 「관리자가 아닌 미해소 0건」까지만
--       보장한다.
--
--       규칙은 삭제된 `member-authority-backfill-core.ts`(41b101b7)의 투영을 그대로
--       옮긴 것이다. 네 가지를 정확히 따른다.
--
--         1. **이미 있는 정본 값이 이긴다.** 원본은 어디서나
--            `user.profile?.X ?? 기본값` 모양이다. 세 UPDATE 모두 `IS NULL`로
--            거른다 — 정본 쓰기가 먼저 채운 값을 legacy 사실로 덮지 않는다.
--
--         2. **배정된 legacy 역할이 먼저고, ADMIN은 거기서 끝난다.**
--            원본 `projectedSelectedMemberKind`는 `role`이 null일 때만 고른 값을
--            본다: `role === null ? (selectedMemberKind ?? selectedRole) : assigned(role)`.
--            그리고 `assignedMemberKind(ADMIN)`는 null이다. 즉 **ADMIN은
--            `selectedRole`로 내려가지 않는다** — `selectedRole`이 STAFF든
--            STUDENT든 미해소로 남는다. 권한과 정체성은 독립이라
--            「관리자가 교직원을 골랍더라」는 선택 기록일 뿐 확정된 정체성이
--            아니다. 그 분류는 사람이 명시적으로 해야 한다.
--
--         3. **소속 유형의 기본값은 회원 유형과 무관하게 DEPARTMENT다.**
--            원본 `requireMemberProfile`은 `profile?.affiliationKind ?? DEPARTMENT`
--            하나뿐이고 회원 유형으로 갈라지지 않는다. STAFF를
--            PROGRAM_OFFICE로 짐작하면 그것은 원본에 없던 새 추정이다.
--
--         4. **미해소 행은 세 칸이 함께 비어 있다.** 원본은 소속명·소속 유형을
--            `requireMemberProfile` **안에서만** 채우므로, 회원 유형이 정해지지
--            않은 행은 세 칸이 모두 null로 남는다(`projectUnresolvedAdmin`도
--            정확히 그렇게 한다). 정체성이 없는데 소속만 지어내지 않는다.
-- ---------------------------------------------------------------------------

-- 회원 유형.
--
-- CASE의 순서가 계약이다. 배정된 `role`을 먼저 보고, ADMIN은 그 자리에서
-- NULL로 끝난다 — 아래 `selectedMemberKind`/`selectedRole` 분기로 **내려가지
-- 않는다**. `role`이 NULL인 행만 그 분기에 닿는다(SQL은 NULL 조건을
-- 불일치로 보므로 앞의 세 WHEN을 자연히 비컨난다).
UPDATE "UserProfile" AS p
SET "memberKind" = CASE
    WHEN u."role" = 'STUDENT' THEN 'STUDENT'::"MemberKind"
    WHEN u."role" = 'STAFF' THEN 'STAFF'::"MemberKind"
    -- 배정된 관리자는 여기서 미해소로 확정된다.
    WHEN u."role" = 'ADMIN' THEN NULL
    -- 여기부터는 `role`이 NULL인 행뿐이다.
    WHEN u."selectedMemberKind" IS NOT NULL THEN u."selectedMemberKind"
    WHEN u."selectedRole" = 'STUDENT' THEN 'STUDENT'::"MemberKind"
    WHEN u."selectedRole" = 'STAFF' THEN 'STAFF'::"MemberKind"
    ELSE NULL
  END
FROM "User" AS u
WHERE p."userId" = u."id" AND p."memberKind" IS NULL;

-- 소속명: `department`의 사본이다. `department`는 NOT NULL이므로 추정이 아니라
-- 같은 값의 다른 이름이다(원본 `requireMemberProfile`의 affiliationName 투영).
--
-- 회원 유형이 정해진 행에만 채운다. 원본은 이 투영을 `requireMemberProfile`
-- 안에서만 하므로, 미해소 관리자는 소속명도 null로 남았다.
UPDATE "UserProfile"
SET "affiliationName" = "department"
WHERE "affiliationName" IS NULL AND "memberKind" IS NOT NULL;

-- 소속 유형: 원본의 기본값은 `profile?.affiliationKind ?? DEPARTMENT` 하나뿐이고
-- 회원 유형으로 갈라지지 않는다 — STAFF도 DEPARTMENT에서 시작한다.
-- (STUDENT가 DEPARTMENT가 아닌 것만 원본이 불변식으로 막았다.)
-- 소속명과 같은 이유로 회원 유형이 정해진 행에만 채운다.
UPDATE "UserProfile"
SET "affiliationKind" = 'DEPARTMENT'::"AffiliationKind"
WHERE "affiliationKind" IS NULL AND "memberKind" IS NOT NULL;
