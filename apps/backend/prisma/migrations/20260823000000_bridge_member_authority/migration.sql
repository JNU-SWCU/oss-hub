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
-- 여기에 NOT NULL을 걸면 직전 이미지의 가입 완료가 전부 실패한다. 그 NULL을 정본
-- 사실로 접는 일은 애플리케이션의 단일 경계(`profiles/user-profile-read.ts`)가 한다.
--
-- 되돌리기: 이 bridge 커밋 하나를 revert하면 최종 contract diff가 그대로 복원된다.

-- ---------------------------------------------------------------------------
-- [1/2] legacy 역할에서 접근 권한 두 칸을 backfill한다.
--
--       규칙은 v0.6.110의 호환 해석기와 동일하다:
--         ADMIN → 관리자 접근 O, 교직원 접근 O
--         STAFF → 교직원 접근 O
--         그 밖(STUDENT · NULL) → 둘 다 X
--
--       이미 값이 있는 행은 건드리지 않는다(`IS NULL` 조건). 정본 쓰기가 이미
--       확정한 권한을 legacy 역할이 되돌리면 안 된다 — 이 둘이 어긋난 계정이
--       cutover 도중 생길 수 있고, 그때 정본 값이 최신이다.
-- ---------------------------------------------------------------------------
UPDATE "User"
SET "hasStaffAccess" = ("role" IN ('STAFF', 'ADMIN'))
WHERE "hasStaffAccess" IS NULL;

UPDATE "User"
SET "hasAdminAccess" = ("role" = 'ADMIN')
WHERE "hasAdminAccess" IS NULL;

-- ---------------------------------------------------------------------------
-- [2/2] 두 칸을 NOT NULL + DEFAULT FALSE로 잠근다.
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
