CREATE TEMP TABLE migration_cases (
  id text, selected text, kind text, staff boolean DEFAULT false,
  admin boolean DEFAULT false, request text, incomplete boolean DEFAULT false
);
INSERT INTO migration_cases(id,selected,kind,staff,admin,request,incomplete) VALUES
('unselected',NULL,NULL,false,false,NULL,false),
('unselected-admin',NULL,NULL,false,true,NULL,false),
('selected-student','STUDENT',NULL,false,false,NULL,false),
('selected-staff','STAFF',NULL,false,false,NULL,false),
('selected-staff-admin','STAFF',NULL,false,true,NULL,false),
('student-admin','STUDENT','STUDENT',false,true,NULL,false),
('student-admin-staff','STUDENT','STUDENT',true,true,NULL,false),
('incomplete-student','STUDENT','STUDENT',false,false,NULL,true),
('staff-pending','STAFF','STAFF',false,false,'PENDING',false),
('staff-approved','STAFF','STAFF',true,false,'APPROVED',false),
('staff-rejected','STAFF','STAFF',false,false,'REJECTED',false),
('staff-revoked','STAFF','STAFF',false,false,'REVOKED',false),
('staff-retained-id','STAFF','STAFF',true,false,NULL,false),
('staff-no-request','STAFF','STAFF',false,false,NULL,false),
('staff-access-no-request','STAFF','STAFF',true,false,NULL,false),
('staff-access-pending','STAFF','STAFF',true,false,'PENDING',false),
('staff-access-rejected','STAFF','STAFF',true,false,'REJECTED',false),
('staff-access-revoked','STAFF','STAFF',true,false,'REVOKED',false),
('staff-without-access-approved','STAFF','STAFF',false,false,'APPROVED',false),
('student-old-request','STUDENT','STUDENT',false,false,'REJECTED',false),
('kind-conflict','STAFF','STUDENT',false,false,NULL,false);
INSERT INTO migration_cases(id,selected,kind)
SELECT 'filler-' || n, 'STUDENT', 'STUDENT' FROM generate_series(1,141) n;
INSERT INTO "User" (
  id,"githubId",login,"selectedMemberKind","hasStaffAccess","hasAdminAccess",
  phone,"notificationEmail","notifyEnabled","accountStatus","sessionVersion",
  "createdAt","updatedAt"
)
SELECT id,9900000000 + row_number() OVER (ORDER BY id),id,selected::"MemberKind",
  staff,admin,CASE WHEN id='student-admin' THEN '01000000000' END,
  CASE WHEN id='student-admin' THEN 'fixture@example.invalid' END,
  id='student-admin',
  (CASE WHEN id='filler-141' THEN 'DEACTIVATED' ELSE 'ACTIVE' END)::"AccountStatus",
  row_number() OVER (ORDER BY id),
  '2026-07-01','2026-07-02'
FROM migration_cases;
INSERT INTO "UserProfile" (
  "userId",name,"studentId","staffNumber",department,"memberKind",
  "affiliationKind","affiliationName","createdAt","updatedAt"
)
SELECT id,'Synthetic ' || id,
  CASE WHEN NOT incomplete AND (kind='STUDENT' OR id='staff-retained-id')
    THEN (9700000000 + row_number() OVER (ORDER BY id))::text END,
  CASE WHEN kind='STAFF' THEN 'S-' || id END,
  'Synthetic department',kind::"MemberKind",
  (CASE WHEN kind='STUDENT' THEN 'DEPARTMENT' ELSE 'PROGRAM_OFFICE' END)::"AffiliationKind",
  'Synthetic department','2026-08-01 01:02:03','2026-09-01 04:05:06'
FROM migration_cases WHERE kind IS NOT NULL;
INSERT INTO "StaffAccessRequest" (
  id,"userId",status,"rejectionReason","decidedById","decidedAt","createdAt","updatedAt"
)
SELECT 'request:' || id,id,request::"StaffAccessRequestStatus",
  CASE WHEN request='REJECTED' THEN 'Synthetic rejection' END,
  CASE WHEN request<>'PENDING' THEN 'student-admin' END,
  CASE WHEN request<>'PENDING' THEN timestamp '2026-09-03' END,
  '2026-09-02','2026-09-03'
FROM migration_cases WHERE request IS NOT NULL;
INSERT INTO "StaffAccessRequest" (id,"userId",status,"createdAt","updatedAt")
VALUES ('request:staff-rejected:older','staff-rejected','REVOKED','2026-09-02','2026-09-03');
INSERT INTO "Consent" (id,"userId","policyVersion","consentedAt") VALUES
('consent:1','student-admin','2026-07-01','2026-08-01'),
('consent:2','student-admin','2026-08-01','2026-09-01');
INSERT INTO "LoginHistory" (id,"userId",event,success,"loginAt")
VALUES ('login:1','student-admin','LOGIN',true,'2026-09-02');
INSERT INTO "AuditLog" (id,"actorId",action,"targetType","targetId",metadata,"occurredAt") VALUES
('audit:mixed','student-admin','USER_ROLE_CHANGED','USER','student-admin-staff',
 '{"schemaVersion":1,"eventKind":"DIRECT_ROLE_CHANGED","before":{"role":"STUDENT"},"after":{"role":"ADMIN"}}','2026-09-03'),
('audit:request','student-admin','STAFF_ROLE_REQUEST_REJECTED','ROLE_REQUEST','request:staff-rejected',
 '{"schemaVersion":1,"rejectionReason":"Synthetic rejection"}','2026-09-03'),
('audit:malformed','student-admin','USER_PROFILE_UPDATED','USER','student-admin',
 '["unrecognized legacy metadata",7]','2026-09-03'),
('audit:admin','student-admin','GRANT_ADMIN_ACCESS','USER','unselected-admin',
 '{"schemaVersion":1}','2026-09-03'),
('audit:other','student-admin','PROGRAM_UPDATED','PROGRAM','old-program',
 '{"untouched":true}','2026-09-03');
