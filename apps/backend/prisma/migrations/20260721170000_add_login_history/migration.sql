-- CreateEnum
CREATE TYPE "LoginHistoryEvent" AS ENUM ('LOGIN', 'LOGOUT');

-- CreateTable
CREATE TABLE "LoginHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" "LoginHistoryEvent" NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "success" BOOLEAN NOT NULL,
    "loginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LoginHistory_userId_loginAt_idx" ON "LoginHistory"("userId", "loginAt");

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
