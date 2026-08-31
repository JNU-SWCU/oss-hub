# 프로그램 프로토타입 정합

이 문서는 프로그램 참여 플로우를 승인된 프로토타입(역할별 화면 스펙)에 맞추는 작업의 실행 계획이다.
백엔드 데이터 모델은 Foundation 레인이 먼저 골격을 놓았고, 그 위에 화면별 레인이 endpoint와 UI를 채우는 순서로 진행한다.
착수 시점 상태는 작성자 저널(`docs/handoff/team-state/<핸들>.md`)의 마지막 항목을 따른다 — 이 문서는 계획이고 진행 상태의 원본은 GitHub Issue·PR이다.

## 목표

학생·교직원이 프로그램에 참여하는 흐름(신청 → 팀 구성 → 마일스톤별 서류 제출 → 심사 → 참여 팀 열람 → 게시판 소통)을
프로토타입 스펙과 맞춘다.
기존 신청·심사·저장소 자동화 경로(`programs`·`applications`·`submission-reviews`·`repositories` 등, 다른 레인 전속)는 건드리지 않고
그 위에 확장으로만 더한다.

## 범위

- 마일스톤별 제출 서류 모델 — 마일스톤 하나에 서류 항목 여러 건, 항목별 필수/선택·양식 파일·제출 이력.
  기존 `Milestone.submissionType` 단일 제출 방식과 병존한다.
- 프로그램 스코프 상세 셸 — 좌측 패널, breadcrumb, 마감 카운트다운, 팩트 바(주관·운영기간·참여학생·팀·연결 저장소·제출률).
- 참여 팀 공개 목록 — 학생·교직원 공통 열람 전용 화면.
- 팀 초대 — 검색으로 대상 찾기, 초대 발송, 수락/거절.
  기존 참여 코드(`joinCodeDigest`) 합류 방식과 병존한다.
- 게시판 — `Post`/`Comment`, 작성자 역할이 카테고리(공지/질문)를 자동 결정한다.
- 프로그램 목록 카드 개인화 — 학생은 본인 신청 상태, 교직원은 지원·승인대기 건수 집계를 카드에 노출한다.
- 신청 폼 — 개인정보 수집 동의, GitHub 연동 표시, 저장소 연결 방식 선택, 팀 구성 입력.
- 상태 라벨 변경 — `upcoming` 표시 문구를 '접수대기'에서 '예정'으로 바꾼다.

## 범위 밖

- 공개 아카이브·랭킹 화면 — 이 작업이 건드리는 프로그램 스코프 화면과 분리된 별도 표면이다.
- 목록 카드 개인화 집계(지원·승인대기 건수)의 성능 최적화 — 이번 범위는 정확성까지이고, N+1·캐싱 등 후속은 별도로 다룬다.

## 데이터 모델 변경 요약

마이그레이션 `20260804110314_add_milestone_documents_board_team_invitations` 한 건으로 통합했다.

- **마일스톤별 제출 서류(3개 모델, 기존 `Submission` 계열과 병존)**
  - `MilestoneDocument` — 마일스톤이 요구하는 서류 항목 정의(name·required·sortOrder·submissionType, 기존 `MilestoneSubmissionType` enum 재사용).
  - `MilestoneDocumentTemplateFile` — 서류 항목별 양식 파일, 항목당 1건(양식 교체는 덮어쓰기).
  - `MilestoneDocumentSubmission` — (서류 항목 × 신청)당 제출 상태·시각. 행이 없으면 미제출.
  - `SubmissionFile`에 nullable FK `milestoneDocumentSubmissionId`를 추가해 FILE 유형 서류 제출에 파일을 붙인다.
    기존 `submissionRevisionId` 경로와는 상호배타이며, 이 XOR 제약은 Prisma DSL로 표현할 수 없어 마이그레이션 SQL의 CHECK 제약으로 강제한다.
- **게시판(2개 모델)** — `BoardPost`(programId·authorId·category·title·body·pinned), `BoardComment`(postId·authorId·body).
  카테고리(`NOTICE`/`QNA`)는 작성자 역할이 정하고 사용자가 직접 고르지 않는다.
- **팀 초대(1개 모델)** — `TeamInvitation`(teamId+programId composite FK·inviteeId·invitedById·status·invitedAt·respondedAt).
  기존 `TeamMember.@@unique([programId, userId])`와는 별도 관심사이며 수락 시 그 unique를 통과해야 한다.
  동일 (teamId, inviteeId)에 `PENDING` 중복 금지는 partial unique index로 마이그레이션 SQL에만 존재한다(Prisma 미표현).
- **NestJS 모듈 스켈레톤 4개** — `milestone-documents`·`board`·`team-invitations`·`program-overview`.
  각 모듈은 `SessionGuard` 적용, 읽기 endpoint 1개씩만 갖춘 최소 골격이며 나머지(생성·수정·제출·초대 응답 등)는 화면별 레인이 채운다.
  기존 `programs`·`applications` 컨트롤러·라우트와는 겹치지 않는 독립 경로를 쓴다.
- **프론트엔드(진행 중, 다른 레인 소유)** — `ProgramListItem`에 `note`·`viewerApplicationStatus`·`applicationCount`·`pendingApplicationCount` 필드 추가,
  `PROGRAM_LIST_STATUS_LABELS.upcoming`을 '접수대기'에서 '예정'으로 변경, `PROGRAM_CATEGORY_LABELS` SSOT 신설.

## 검증 방법

- `pnpm --filter backend typecheck`, `pnpm --filter frontend typecheck` — 신규 모델·DTO·타입 정합 확인.
- backend unit·integration 테스트 — 신규 모듈 리포지토리·서비스 계층, 기존 `Submission`/`TeamMember` 계열과의 병존(상호배타 CHECK·unique 제약) 회귀.
- frontend unit 테스트 — 카드 개인화 필드 통과, 상태 라벨 변경 회귀.
- `apps/frontend/test-support/local-review` 픽스처와 `src/app/local-review*`의 얇은 어댑터 기반 브라우저 QA — 실 백엔드 없이 역할별(학생/교직원) 화면 흐름을 확인한다.
- `pnpm --filter backend exec prisma validate`·`prisma migrate status`로 스키마·마이그레이션 정합 확인.

## 열린 질문

- 서류 제출 현황의 지각 판정 — 마감 시각(`dueAt`) 이후 제출을 자동으로 지각 처리할지, 별도 유예 규칙을 둘지.
- 참여 팀 카드 클릭 시 상세(활동 로그·진행 상황)로 들어가는 기능을 둘지, 구성원 목록 열람으로 의도적으로 한정할지.
- 게시판이 공지/질문 2종을 넘어 카테고리를 확장할지, 역할↔글종류 1:1 매핑을 고정 규칙으로 둘지.
- 팀 초대 수락 절차 도입 이후에도 기존 참여 코드 합류 방식을 유지할지, 두 경로의 우선순위를 어떻게 안내할지.
- 프로그램 목록 카드의 교직원용 집계(지원·승인대기 건수)가 로그인 사용자 기준(본인이 운영하는 프로그램)인지 시스템 전체 기준인지.
- 신청 폼의 저장소 연결 방식 선택이 기존 프로비저닝 자동화(`repositories` 모듈, 다른 레인 전속) 계약과 어떻게 맞물리는지 — 이 작업 범위에서는 화면 표시까지만 다루고 실제 연동 로직은 다루지 않는다.
