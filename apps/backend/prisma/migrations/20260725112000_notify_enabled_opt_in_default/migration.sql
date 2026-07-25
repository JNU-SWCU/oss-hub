-- #127 PM: 알림 수신은 opt-in. 기존 행 값은 유지하고 신규 기본값만 off로 둔다.
ALTER TABLE "User" ALTER COLUMN "notifyEnabled" SET DEFAULT false;
