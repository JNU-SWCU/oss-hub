-- Preserve the old value before clearing student IDs from non-student users.
INSERT INTO public."UserHistory" (id, "userId", "actorId", event, source, "sourceTable", "sourceId", "sourcePart", data)
SELECT 'migration:student-id-requires-student:' || u.id, u.id, NULL, 'PROFILE_UPDATED', 'MIGRATION', 'User', u.id, 'student_id_requires_student_type',
  jsonb_build_object('schemaVersion', 1, 'recordKind', 'DOMAIN_EVENT', 'action', 'USER_PROFILE_UPDATED',
    'targetType', 'USER', 'targetId', u.id, 'request', NULL,
    'metadata', jsonb_build_object('schemaVersion', 1,
      'actor', jsonb_build_object('displayName', NULL, 'githubLogin', 'migration'),
      'target', jsonb_build_object('displayName', u.name, 'githubLogin', u.login),
      'changes', jsonb_build_array(jsonb_build_object('field', 'studentId', 'before', u."studentId", 'after', NULL))))
FROM public."User" u WHERE u."studentId" IS NOT NULL AND u.type <> 'STUDENT';

UPDATE public."User" SET "studentId" = NULL WHERE "studentId" IS NOT NULL AND type <> 'STUDENT';

ALTER TABLE public."User" ADD CONSTRAINT "User_studentId_requires_student_check"
  CHECK ("studentId" IS NULL OR type = 'STUDENT');
