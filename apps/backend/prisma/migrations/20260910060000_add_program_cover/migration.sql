-- CreateTable
CREATE TABLE "ProgramCover" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "storageKey" VARCHAR(512) NOT NULL,
    "mimeType" VARCHAR(127) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,

    CONSTRAINT "ProgramCover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProgramCover_programId_key" ON "ProgramCover"("programId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramCover_storageKey_key" ON "ProgramCover"("storageKey");

-- AddForeignKey
ALTER TABLE "ProgramCover" ADD CONSTRAINT "ProgramCover_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- 대표 이미지가 비공개 서류 객체를 참조하지 않도록 저장 경계를 고정한다.
ALTER TABLE "ProgramCover" ADD CONSTRAINT "ProgramCover_storageKey_check"
    CHECK ("storageKey" LIKE 'program-covers/%');
ALTER TABLE "ProgramCover" ADD CONSTRAINT "ProgramCover_mimeType_check"
    CHECK ("mimeType" IN ('image/jpeg', 'image/png'));
ALTER TABLE "ProgramCover" ADD CONSTRAINT "ProgramCover_sizeBytes_check"
    CHECK ("sizeBytes" BETWEEN 1 AND 5242880);
