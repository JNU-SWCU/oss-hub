-- legacy-submission 이관 리허설이 심는 원본 그래프. 값은 전부 합성이다.
--
-- 이 파일은 **expand 직전** 스키마 위에서 돈다. 그 시점 Prisma 클라이언트는 이관 이후
-- 모양으로 생성되어 있어 사라진 세 테이블을 쓸 수 없으므로 SQL을 직접 낸다.
--
-- id 접두사 세 갈래가 이 픽스처의 전부다.
--   `seed:`            — 이관이 폐기 대상으로 보는 예약 그래프. Submission·Application 둘 다
--                        이 접두사여야 폐기 대상이며, 한쪽만이면 생산 데이터로 취급된다.
--   `fixture-synthetic:` — 생산 모양(비-seed) 그래프. bridge가 심는 write fence는 id에
--                        `synthetic`이 든 행을 통과시키므로 negative 레인이 이 행만 흔든다.
--   `fixture:`          — 생산 모양이면서 fence 면제도 아닌 행. bridge 이후 원본이 정말
--                        잠기는지 증명하는 데만 쓰고 어떤 레인도 이 행을 건드리지 않는다.

BEGIN;

INSERT INTO "User" (id, "githubId", login, "accountStatus", "createdAt", "updatedAt") VALUES
  ('fixture-synthetic:legacy-submission:user:student', 9910000001, 'synthetic-legacy-student', 'ACTIVE', TIMESTAMP '2026-01-02 00:00:00', TIMESTAMP '2026-01-02 00:00:00'),
  ('fixture-synthetic:legacy-submission:user:reviewer', 9910000002, 'synthetic-legacy-reviewer', 'ACTIVE', TIMESTAMP '2026-01-02 00:00:00', TIMESTAMP '2026-01-02 00:00:00');

INSERT INTO "UserProfile" ("userId", name, "studentId", department, "memberKind", "affiliationKind", "affiliationName", "createdAt", "updatedAt") VALUES
  ('fixture-synthetic:legacy-submission:user:student', '합성 학생', '790001', '합성 인공지능학부', 'STUDENT', 'DEPARTMENT', '합성 인공지능학부', TIMESTAMP '2026-01-02 00:00:00', TIMESTAMP '2026-01-02 00:00:00'),
  ('fixture-synthetic:legacy-submission:user:reviewer', '합성 검토자', NULL, '합성 사업단', 'STAFF', 'PROGRAM_OFFICE', '합성 사업단', TIMESTAMP '2026-01-02 00:00:00', TIMESTAMP '2026-01-02 00:00:00');

INSERT INTO "Program" (id, name, organizer, category, "applicationTemplateKey", "applicationTemplateVersion", "applicationStartAt", "applicationEndAt", "startAt", "endAt", "teamMinSize", "teamMaxSize", description, "createdAt", "updatedAt") VALUES
  ('fixture-synthetic:legacy-submission:program', '합성 이관 리허설 프로그램', '합성 사업단', 'BASIC', 'basic', 1, TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-10 00:00:00', TIMESTAMP '2026-01-10 00:00:00', TIMESTAMP '2026-12-31 00:00:00', 1, 4, '합성 설명', TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-01 00:00:00');

-- 신청은 (프로그램, 팀)마다 하나뿐이라 신청 네 건에는 팀도 네 개가 필요하다.
INSERT INTO "Team" (id, "programId", name, "leaderId", "joinCodeDigest", "createdAt", "updatedAt") VALUES
  ('fixture-synthetic:legacy-submission:team:001', 'fixture-synthetic:legacy-submission:program', '합성 팀 001', 'fixture-synthetic:legacy-submission:user:student', 'synthetic-join-code-digest-001', TIMESTAMP '2026-01-02 00:00:00', TIMESTAMP '2026-01-02 00:00:00'),
  ('fixture-synthetic:legacy-submission:team:002', 'fixture-synthetic:legacy-submission:program', '합성 팀 002', 'fixture-synthetic:legacy-submission:user:student', 'synthetic-join-code-digest-002', TIMESTAMP '2026-01-02 00:00:00', TIMESTAMP '2026-01-02 00:00:00'),
  ('fixture:legacy-submission:team:fenced', 'fixture-synthetic:legacy-submission:program', '합성 팀 잠금', 'fixture-synthetic:legacy-submission:user:student', 'synthetic-join-code-digest-fenced', TIMESTAMP '2026-01-02 00:00:00', TIMESTAMP '2026-01-02 00:00:00'),
  ('seed:legacy-submission:team:001', 'fixture-synthetic:legacy-submission:program', '합성 seed 팀', 'fixture-synthetic:legacy-submission:user:student', 'synthetic-join-code-digest-seed', TIMESTAMP '2026-01-02 00:00:00', TIMESTAMP '2026-01-02 00:00:00');

INSERT INTO "Milestone" (id, "programId", name, "startAt", "dueAt", "submissionType", "createdAt", "updatedAt") VALUES
  ('fixture-synthetic:legacy-submission:milestone:file', 'fixture-synthetic:legacy-submission:program', '합성 1차 산출물', TIMESTAMP '2026-01-10 00:00:00', TIMESTAMP '2026-02-10 00:00:00', 'FILE', TIMESTAMP '2026-01-05 00:00:00', TIMESTAMP '2026-01-05 00:00:00'),
  ('fixture-synthetic:legacy-submission:milestone:text', 'fixture-synthetic:legacy-submission:program', '합성 2차 보고', TIMESTAMP '2026-01-10 00:00:00', TIMESTAMP '2026-03-10 00:00:00', 'TEXT', TIMESTAMP '2026-01-05 00:00:00', TIMESTAMP '2026-01-05 00:00:00');

-- 신청 네 건. 앞 둘은 생산 모양, `fixture:`는 fence 증명용, `seed:`는 폐기 대상 그래프다.
INSERT INTO "Application" (id, "programId", "applicantId", "teamId", answers, "applicationTemplateVersion", status, "submittedAt", "createdAt", "updatedAt") VALUES
  ('fixture-synthetic:legacy-submission:application:001', 'fixture-synthetic:legacy-submission:program', 'fixture-synthetic:legacy-submission:user:student', 'fixture-synthetic:legacy-submission:team:001', '{"synthetic":true}', 1, 'APPROVED', TIMESTAMP '2026-01-06 00:00:00', TIMESTAMP '2026-01-06 00:00:00', TIMESTAMP '2026-01-06 00:00:00'),
  ('fixture-synthetic:legacy-submission:application:002', 'fixture-synthetic:legacy-submission:program', 'fixture-synthetic:legacy-submission:user:student', 'fixture-synthetic:legacy-submission:team:002', '{"synthetic":true}', 1, 'APPROVED', TIMESTAMP '2026-01-06 00:00:00', TIMESTAMP '2026-01-06 00:00:00', TIMESTAMP '2026-01-06 00:00:00'),
  ('fixture:legacy-submission:application:fenced', 'fixture-synthetic:legacy-submission:program', 'fixture-synthetic:legacy-submission:user:student', 'fixture:legacy-submission:team:fenced', '{"synthetic":true}', 1, 'APPROVED', TIMESTAMP '2026-01-06 00:00:00', TIMESTAMP '2026-01-06 00:00:00', TIMESTAMP '2026-01-06 00:00:00'),
  ('seed:legacy-submission:application:001', 'fixture-synthetic:legacy-submission:program', 'fixture-synthetic:legacy-submission:user:student', 'seed:legacy-submission:team:001', '{"synthetic":true}', 1, 'APPROVED', TIMESTAMP '2026-01-06 00:00:00', TIMESTAMP '2026-01-06 00:00:00', TIMESTAMP '2026-01-06 00:00:00');

-- 이관과 무관한 대조군 문서 원장. 이관 전후로 한 행도 움직이지 않아야 한다.
INSERT INTO "MilestoneDocument" (id, "milestoneId", name, required, "sortOrder", "createdAt", "updatedAt") VALUES
  ('fixture-synthetic:legacy-submission:document:control', 'fixture-synthetic:legacy-submission:milestone:text', '합성 대조 문서', TRUE, 0, TIMESTAMP '2026-01-05 00:00:00', TIMESTAMP '2026-01-05 00:00:00'),
  ('seed:legacy-submission:document:target', 'fixture-synthetic:legacy-submission:milestone:file', '합성 seed 대상 문서', TRUE, 0, TIMESTAMP '2026-01-05 00:00:00', TIMESTAMP '2026-01-05 00:00:00');

INSERT INTO "MilestoneDocumentSubmission" (id, "milestoneDocumentId", "applicationId", status, content, revision, "submittedById", "submittedAt", "createdAt", "updatedAt") VALUES
  ('fixture-synthetic:legacy-submission:document-submission:control', 'fixture-synthetic:legacy-submission:document:control', 'fixture-synthetic:legacy-submission:application:001', 'APPROVED', '{"type":"TEXT","text":"합성 대조 본문"}', 1, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-02-01 00:00:00', TIMESTAMP '2026-02-01 00:00:00', TIMESTAMP '2026-02-02 00:00:00'),
  ('seed:legacy-submission:document-submission:target', 'seed:legacy-submission:document:target', 'seed:legacy-submission:application:001', 'SUBMITTED', NULL, 1, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-02-01 00:00:00', TIMESTAMP '2026-02-01 00:00:00', TIMESTAMP '2026-02-01 00:00:00');

INSERT INTO "MilestoneDocumentSubmissionHistory" (id, "milestoneDocumentSubmissionId", event, revision, content, comment, "actorId", "createdAt") VALUES
  ('fixture-synthetic:legacy-submission:document-history:control', 'fixture-synthetic:legacy-submission:document-submission:control', 'SUBMITTED', 1, '{"type":"TEXT","text":"합성 대조 본문"}', NULL, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-02-01 00:00:00'),
  ('seed:legacy-submission:document-history:target', 'seed:legacy-submission:document-submission:target', 'SUBMITTED', 1, NULL, NULL, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-02-01 00:00:00');

INSERT INTO "MilestoneDocumentReviewHistory" (id, "milestoneDocumentSubmissionId", "submissionHistoryId", "reviewerId", decision, comment, "reviewedAt") VALUES
  ('fixture-synthetic:legacy-submission:document-review:control', 'fixture-synthetic:legacy-submission:document-submission:control', 'fixture-synthetic:legacy-submission:document-history:control', 'fixture-synthetic:legacy-submission:user:reviewer', 'APPROVED', '합성 대조 검토', TIMESTAMP '2026-02-02 00:00:00');

-- 원본 원장. 한 건은 재제출 3회 + 검토 2회, 한 건은 단발 + 승인, 한 건은 2회 + 검토 1회다.
-- 게이트 아홉 개 중 이력·검토·파일 계열은 이 분포가 있어야만 볼 것이 생긴다.
INSERT INTO "Submission" (id, "milestoneId", "applicationId", status, "currentRevision", "createdAt", "updatedAt") VALUES
  ('fixture-synthetic:legacy-submission:submission:multi', 'fixture-synthetic:legacy-submission:milestone:file', 'fixture-synthetic:legacy-submission:application:001', 'CHANGES_REQUESTED', 3, TIMESTAMP '2026-01-20 00:00:00', TIMESTAMP '2026-01-27 00:00:00'),
  ('fixture-synthetic:legacy-submission:submission:single', 'fixture-synthetic:legacy-submission:milestone:text', 'fixture-synthetic:legacy-submission:application:001', 'APPROVED', 1, TIMESTAMP '2026-01-21 00:00:00', TIMESTAMP '2026-01-22 00:00:00'),
  ('fixture-synthetic:legacy-submission:submission:pair', 'fixture-synthetic:legacy-submission:milestone:file', 'fixture-synthetic:legacy-submission:application:002', 'SUBMITTED', 2, TIMESTAMP '2026-01-20 00:00:00', TIMESTAMP '2026-01-25 00:00:00'),
  ('fixture:legacy-submission:submission:fenced', 'fixture-synthetic:legacy-submission:milestone:text', 'fixture:legacy-submission:application:fenced', 'SUBMITTED', 1, TIMESTAMP '2026-01-20 00:00:00', TIMESTAMP '2026-01-20 00:00:00'),
  ('seed:legacy-submission:submission:mapped', 'fixture-synthetic:legacy-submission:milestone:file', 'seed:legacy-submission:application:001', 'SUBMITTED', 1, TIMESTAMP '2026-01-20 00:00:00', TIMESTAMP '2026-01-20 00:00:00'),
  ('seed:legacy-submission:submission:orphan', 'fixture-synthetic:legacy-submission:milestone:text', 'seed:legacy-submission:application:001', 'SUBMITTED', 1, TIMESTAMP '2026-01-20 00:00:00', TIMESTAMP '2026-01-20 00:00:00');

INSERT INTO "SubmissionRevision" (id, "submissionId", revision, "submissionType", content, comment, "submittedById", "submittedAt") VALUES
  ('fixture-synthetic:legacy-submission:revision:multi:1', 'fixture-synthetic:legacy-submission:submission:multi', 1, 'FILE', '{"type":"FILE","fileId":"fixture-synthetic:legacy-submission:file:multi:1"}', '첫 제출', 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-01-20 09:00:00'),
  ('fixture-synthetic:legacy-submission:revision:multi:2', 'fixture-synthetic:legacy-submission:submission:multi', 2, 'FILE', '{"type":"FILE","fileId":"fixture-synthetic:legacy-submission:file:multi:1"}', NULL, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-01-23 09:00:00'),
  ('fixture-synthetic:legacy-submission:revision:multi:3', 'fixture-synthetic:legacy-submission:submission:multi', 3, 'FILE', '{"type":"FILE","fileId":"fixture-synthetic:legacy-submission:file:multi:3"}', '세 번째 제출', 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-01-26 09:00:00'),
  ('fixture-synthetic:legacy-submission:revision:single:1', 'fixture-synthetic:legacy-submission:submission:single', 1, 'TEXT', '{"type":"TEXT","text":"합성 단발 제출"}', NULL, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-01-21 09:00:00'),
  ('fixture-synthetic:legacy-submission:revision:pair:1', 'fixture-synthetic:legacy-submission:submission:pair', 1, 'FILE', '{"type":"FILE","fileId":"fixture-synthetic:legacy-submission:file:pair:2"}', NULL, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-01-20 10:00:00'),
  ('fixture-synthetic:legacy-submission:revision:pair:2', 'fixture-synthetic:legacy-submission:submission:pair', 2, 'FILE', '{"type":"FILE","fileId":"fixture-synthetic:legacy-submission:file:pair:2"}', '보완 제출', 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-01-24 10:00:00'),
  ('fixture:legacy-submission:revision:fenced:1', 'fixture:legacy-submission:submission:fenced', 1, 'TEXT', '{"type":"TEXT","text":"합성 잠금 제출"}', NULL, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-01-20 11:00:00'),
  ('seed:legacy-submission:revision:mapped:1', 'seed:legacy-submission:submission:mapped', 1, 'FILE', '{"type":"FILE","fileId":"seed:legacy-submission:file:mapped"}', NULL, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-01-20 12:00:00'),
  ('seed:legacy-submission:revision:orphan:1', 'seed:legacy-submission:submission:orphan', 1, 'TEXT', '{"type":"TEXT","text":"합성 seed 본문"}', NULL, 'fixture-synthetic:legacy-submission:user:student', TIMESTAMP '2026-01-20 13:00:00');

INSERT INTO "Review" (id, "submissionRevisionId", "reviewerId", decision, comment, "reviewedAt") VALUES
  ('fixture-synthetic:legacy-submission:review:multi:1', 'fixture-synthetic:legacy-submission:revision:multi:1', 'fixture-synthetic:legacy-submission:user:reviewer', 'CHANGES_REQUESTED', '보완이 필요합니다', TIMESTAMP '2026-01-22 09:00:00'),
  ('fixture-synthetic:legacy-submission:review:multi:2', 'fixture-synthetic:legacy-submission:revision:multi:2', 'fixture-synthetic:legacy-submission:user:reviewer', 'REJECTED', NULL, TIMESTAMP '2026-01-25 09:00:00'),
  ('fixture-synthetic:legacy-submission:review:single:1', 'fixture-synthetic:legacy-submission:revision:single:1', 'fixture-synthetic:legacy-submission:user:reviewer', 'APPROVED', '승인합니다', TIMESTAMP '2026-01-22 12:00:00'),
  ('fixture-synthetic:legacy-submission:review:pair:1', 'fixture-synthetic:legacy-submission:revision:pair:1', 'fixture-synthetic:legacy-submission:user:reviewer', 'CHANGES_REQUESTED', NULL, TIMESTAMP '2026-01-23 10:00:00');

-- expand 이전 CHECK는 ATTACHED 파일에 source·target provenance 중 **하나만** 허용한다.
-- 그래서 seed 매핑 파일의 target 연결은 여기 둘 수 없고 expand 직후에 붙인다.
INSERT INTO "SubmissionFile" (id, "uploaderId", "storageKey", "originalFileName", "mimeType", "sizeBytes", "submissionRevisionId", "applicationId", "milestoneId", lifecycle, "pendingExpiresAt", "expiresAt", "createdAt") VALUES
  ('fixture-synthetic:legacy-submission:file:multi:1', 'fixture-synthetic:legacy-submission:user:student', 'synthetic/legacy/multi-1.pdf', '합성 1차.pdf', 'application/pdf', 1024, 'fixture-synthetic:legacy-submission:revision:multi:1', 'fixture-synthetic:legacy-submission:application:001', 'fixture-synthetic:legacy-submission:milestone:file', 'ATTACHED', NULL, NULL, TIMESTAMP '2026-01-20 09:00:00'),
  ('fixture-synthetic:legacy-submission:file:multi:3', 'fixture-synthetic:legacy-submission:user:student', 'synthetic/legacy/multi-3.pdf', '합성 3차.pdf', 'application/pdf', 2048, 'fixture-synthetic:legacy-submission:revision:multi:3', 'fixture-synthetic:legacy-submission:application:001', 'fixture-synthetic:legacy-submission:milestone:file', 'ATTACHED', NULL, NULL, TIMESTAMP '2026-01-26 09:00:00'),
  ('fixture-synthetic:legacy-submission:file:pair:2', 'fixture-synthetic:legacy-submission:user:student', 'synthetic/legacy/pair-2.pdf', '합성 보완.pdf', 'application/pdf', 4096, 'fixture-synthetic:legacy-submission:revision:pair:2', 'fixture-synthetic:legacy-submission:application:002', 'fixture-synthetic:legacy-submission:milestone:file', 'ATTACHED', NULL, NULL, TIMESTAMP '2026-01-24 10:00:00'),
  ('fixture-synthetic:legacy-submission:file:pending', 'fixture-synthetic:legacy-submission:user:student', 'synthetic/legacy/pending.pdf', '합성 대기.pdf', 'application/pdf', 512, NULL, 'fixture-synthetic:legacy-submission:application:002', 'fixture-synthetic:legacy-submission:milestone:file', 'PENDING', TIMESTAMP '2026-03-01 00:00:00', TIMESTAMP '2026-03-01 00:00:00', TIMESTAMP '2026-01-24 11:00:00'),
  ('seed:legacy-submission:file:mapped', 'fixture-synthetic:legacy-submission:user:student', 'synthetic/legacy/seed-mapped.pdf', '합성 seed 매핑.pdf', 'application/pdf', 256, 'seed:legacy-submission:revision:mapped:1', 'seed:legacy-submission:application:001', 'fixture-synthetic:legacy-submission:milestone:file', 'ATTACHED', NULL, NULL, TIMESTAMP '2026-01-20 12:00:00'),
  ('seed:legacy-submission:file:orphan', 'fixture-synthetic:legacy-submission:user:student', 'synthetic/legacy/seed-orphan.pdf', '합성 seed 고아.pdf', 'application/pdf', 128, 'seed:legacy-submission:revision:orphan:1', 'seed:legacy-submission:application:001', 'fixture-synthetic:legacy-submission:milestone:text', 'ATTACHED', NULL, NULL, TIMESTAMP '2026-01-20 13:00:00');

COMMIT;
