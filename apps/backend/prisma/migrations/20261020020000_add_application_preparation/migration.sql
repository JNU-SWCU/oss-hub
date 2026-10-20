-- CreateTable
CREATE TABLE "ApplicationPreparation" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "leaderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationPreparation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationPreparationParticipant" (
    "id" TEXT NOT NULL,
    "preparationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "TeamInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "ApplicationPreparationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationPreparation_id_programId_key" ON "ApplicationPreparation"("id", "programId");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationPreparation_programId_leaderId_key" ON "ApplicationPreparation"("programId", "leaderId");

-- CreateIndex
CREATE INDEX "ApplicationPreparationParticipant_programId_userId_status_idx" ON "ApplicationPreparationParticipant"("programId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationPreparationParticipant_preparationId_userId_key" ON "ApplicationPreparationParticipant"("preparationId", "userId");

-- AddForeignKey
ALTER TABLE "ApplicationPreparation" ADD CONSTRAINT "ApplicationPreparation_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationPreparation" ADD CONSTRAINT "ApplicationPreparation_leaderId_fkey" FOREIGN KEY ("leaderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationPreparationParticipant" ADD CONSTRAINT "ApplicationPreparationParticipant_preparationId_programId_fkey" FOREIGN KEY ("preparationId", "programId") REFERENCES "ApplicationPreparation"("id", "programId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationPreparationParticipant" ADD CONSTRAINT "ApplicationPreparationParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


CREATE UNIQUE INDEX "ApplicationPreparationParticipant_accepted_program_user_key"
ON "ApplicationPreparationParticipant" ("programId", "userId")
WHERE "status" = 'ACCEPTED';
