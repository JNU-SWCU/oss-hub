# 보안 규칙

## 대원칙: 이 repo는 PUBLIC이다

oss-hub는 공개 저장소다. 코드뿐 아니라 Issue 본문, PR 제목·본문·코멘트, 커밋 메시지와 author·committer identity, CI(Actions) 로그, 첨부 스크린샷까지 전부 전 세계에 공개된다.

**올라간 순간 유출로 간주한다. 삭제는 회수가 아니다.** force-push로 지워도 포크, 캐시, 알림 메일, 크롤러에 이미 복제됐다고 가정한다. 따라서 방어선은 "올리기 전"에만 존재한다.

## public-safe deny-list

아래 8종은 repo의 어떤 표면(코드·Issue·PR·커밋 메시지·CI 로그·스크린샷)에도 올리지 않는다.

| # | 금지 항목 | 대신 쓰는 것 |
| --- | --- | --- |
| 1 | 실명 (팀원 포함) | GitHub ID만 (@GoBeromsu, @Lumiere001, @<designer-1>, @<designer-2>) |
| 2 | 교수·사업단·외부 관계자 언급 | 역할 중립 표현 ("외부 의존", "데이터 제공처") |
| 3 | 학번·연락처 이메일·전화번호 | 쓰지 않는다. 연락은 repo 밖에서. 단, 아래 Git commit identity 이메일 예외를 적용한다 |
| 4 | 미공지 행사의 일정·규모·장소 | 공식 공지 이후에만, 공지된 범위만 |
| 5 | 예산·계약·정산 정보 | 쓰지 않는다 |
| 6 | 실데이터 값·실데이터가 보이는 스크린샷 | 합성 fixture (아래 반입 절차 참조) |
| 7 | Notion 문서 본문 인용 | Decision ID 색인만 (아래 참조 규칙 참조) |
| 8 | 자격증명을 모아둔 메모 파일 (`credentials.md`·`secrets.yaml`·`creds.txt` 등)과 개인키 파일 | secret store에만 둔다. 값이 아니라 변수 이름만 `.env.example`에 남긴다 |

## 공개 strict-read 예외

공개 endpoint가 private 테이블을 읽는 것은 owner-approved dedicated public query repository 경계에서만 허용한다.
이 예외는 public 응답을 만드는 읽기 전용 경로에만 적용하며 controller나 일반 service에 Prisma 권한을 부여하지 않는다.
repository는 요청 입력으로 구성되는 query를 받지 않고, 명시적 `select`와 허용된 public DTO 필드만 사용한다.
service는 공개 field allowlist와 eligibility를 적용하고 private 또는 nonexistent 대상에 동일한 404를 반환한다.
private 테이블 간 임의 join, wildcard `include`, 전체 row 조회 후 redact-later, forbidden field fetch는 계속 금지한다.
selector 및 integration review evidence가 없거나 exact-head owner receipt가 없으면 예외를 사용하지 않는다.
허용되는 데이터도 학번·학과·연락처·role/account status·answers/rejection·submission content/review/file·provision error·raw GitHub payload/code/diff/message/email/body·credential와 generation/control metadata를 포함하지 않는다.
실명은 공개 응답에 포함하지 않는다.

### 랭킹 표시명

공개 랭킹은 `githubLogin`만 노출한다(PM 결정, 2026-08-08).
2026-08-03의 실명 노출 허용 결정을 철회한다 — 동의 철회 endpoint가 없는 상태([#554](https://github.com/JNU-SWCU/oss-hub/issues/554))에서 실명을 노출하면 되돌릴 수 없는 노출이 된다.
GitHub ID는 사용자가 이미 공개적으로 선택한 식별자이므로 같은 문제가 생기지 않는다.

가입한 모든 사용자가 노출 대상이다. 기여 유무를 조건으로 걸지 않는다(PM 결정, 2026-08-11) — 기여가 없어도 0으로 표시된다.
집계 범위는 JNU-SWCU Org 저장소 전체(가시성 무관)와 학생 개인 계정의 public 저장소 활동이다.
노출 대상이 가입 즉시·조건 없이 전원으로 확정되므로, 동의 철회 endpoint 부재(#554)로 인한 되돌릴 수 없는 노출이라는 위 리스크도 가입한 전원에 예외 없이 그대로 적용된다.

미가입 org 기여자를 '미가입'으로 구분하던 규칙도 함께 삭제한다 — 미가입자 기여는 적재 시점에 걸러져 행 자체가 존재하지 않는다.

학번·학과·연락처를 비롯한 나머지 금지 항목은 랭킹에서도 그대로 금지한다.

### Git commit identity 이메일 예외

- 기여자가 자신의 Git 설정으로 선택한 commit author·committer identity 이메일은 허용한다.
- GitHub noreply 이메일은 권장 선택지지만 필수는 아니다.
- 이 예외는 다른 사람의 이메일을 대신 입력하거나 공개할 권한을 주지 않는다.
- 본인이 선택하지 않은 identity이거나 제3자 이메일 공개가 의심되면 아래 유출 사고 절차로 처리한다.
- 자동화 계정 식별용 noreply 주소와 RFC 2606 예약 도메인의 합성 예시는 연락처 이메일로 보지 않는다.
- tracked file, Issue·PR 본문, 댓글, 커밋 메시지, CI 로그, 스크린샷에 연락처 이메일을 직접 기록하는 행위는 계속 금지한다.
- `scripts/check-public-safe.sh`는 존재 자체가 유출인 파일 경로(env 실값·개인키·로컬 DB·덤프·자격증명 메모)를 파일명 단계에서 차단하고, 변경된 tracked file의 커밋된 Git blob 내용(`scripts/check-public-safe.sh` 자체와 `pnpm-lock.yaml` 제외), 커밋 메시지, PR 제목·본문의 이메일을 검사하되 위 noreply·합성 예시는 허용한다. author·committer identity 메타데이터는 검사하지 않는다. `--text-only` 모드(`ISSUE_TEXT` 주입)는 Issue 제목·본문과 Issue/PR 댓글에도 동일한 deny-list를 적용한다. CI 로그, 스크린샷은 이 스크립트의 자동 검사 대상이 아니며 금지 정책과 리뷰로 통제한다.
- 금지 파일 경로의 `.env` 계열·개인키·로컬 DB 확장자는 대소문자와 무관하게 차단한다. 허용 예외는 정확한 소문자 `.env.example` 한 가지뿐이다.
- PR이 제어할 수 있는 파일명은 CI 로그에 원문을 출력하지 않고 Git hash 기반 `path-id`로만 표시한다. 줄바꿈·제어문자·Actions annotation 문자열이 포함된 파일명도 같은 규칙을 적용한다.
- quoted local-part, EAI local-part, Unicode domain은 자동 검사의 허용 예외로 지원하지 않는다. 자동 검사는 점으로 구분된 domain과 2자 이상 마지막 label을 가진 quoted·비ASCII email-shaped token, punycode IDN 후보를 보수적으로 차단한다. 점 없는 token은 GitHub handle·멘션 나열·셸 변수 오탐을 피하기 위해 이메일 후보로 간주하지 않고 리뷰로 통제한다. 실제 제품 입력에서 이 범위를 지원하려면 별도 입력 검증 계약과 합성 fixture를 먼저 추가한다.

blocker를 기록할 때는 사람이 아니라 **작업을 주어로** 쓴다.

```text
나쁨: OOO 교수님이 아직 데이터를 안 주셔서 막힘
좋음: 외부 의존: 데이터셋 수령 대기 (owner: @Lumiere001, since 2026-07-16)
```

## 시크릿 관리

- 커밋 대상은 `.env.example`뿐이다. 키 이름과 placeholder만 넣고 실값은 절대 넣지 않는다.
- 실값은 GitHub repo secrets 또는 배포 환경의 secret store에만 둔다. 메신저·Notion·코드 주석으로도 전달하지 않는다.
- CI 로그에 secret이 echo되지 않는지 워크플로 작성 시 확인한다. 디버그 목적으로 환경 변수를 dump하는 스텝을 만들지 않는다.
- 도입 완료(#6): gitleaks + 커스텀 regex(학번, 전화번호, 연락처 이메일, 개인 머신 경로)를 GitHub Actions의 `public-safe` job에서 모든 PR에 실행하고 required check로 강제한다. commit identity 이메일은 위 예외를 적용한다. 실명 목록은 repo에 두지 않으며, PR-controlled script에 repository secret을 전달하지 않도록 `pull_request` CI에는 주입하지 않는다. 실명 검사는 신뢰된 수동 실행의 `BLOCKED_NAMES`와 PR 리뷰로 수행한다.
- 배포 설정(env 키, compose/secret 경로, 배포 절차)이 바뀌면 같은 PR에서 (a) 코드 쪽엔 `.env.example`에 키 이름만 추가/갱신하고, (b) 실값 갱신은 **운영 credentials vault**(원본)에 반영하는 것까지가 완료 조건이다. 형식 예시가 필요하면 `githubId:login:ROLE[:displayName]` 같은 스키마 표기만 쓰고 실값으로 채운 예시는 쓰지 않는다.

## 외부 데이터 반입: 합성 fixture 5단계

외부에서 받은 실데이터는 **원본은 물론 단순 마스킹본도 repo와 외부 LLM에 절대 반입하지 않는다.** 마스킹은 재식별을 막지 못하며, 에이전트에게 원본을 열어주는 순간 그 자체가 외부 LLM 반입이다.

repo에 들어갈 수 있는 것은 아래 절차를 통과한 합성 데이터뿐이다.

1. **격리** — 원본은 에이전트 작업 트리 밖 격리 경로에 둔다. 코딩 에이전트가 Read할 수 없는 위치여야 한다.
2. **스펙 추출** — 비LLM 스크립트로 스키마 스펙(필드명·타입·길이·값 분포)만 추출한다. 실값은 스펙에 포함하지 않는다.
3. **사람 검토** — 추출된 스펙에 실값·식별 정보가 섞이지 않았는지 사람이 검토한다.
4. **생성기 작성** — 검토 통과한 스펙만 LLM에 투입해 합성 데이터 생성기(faker 등)를 작성한다.
5. **교차 스캔** — 생성 결과를 비LLM 스크립트로 교차 스캔(원본 값과의 일치 검사)해 통과한 것만 fixture로 반입한다.

## Notion 참조 규칙

Notion은 회의·기획의 canonical store이고, repo에는 색인만 둔다.

- 허용: Decision ID + **재작성한 제목**(60자 이내) + owner의 GitHub ID
- 금지: Notion 본문 인용, 원문 제목 그대로 복사, 참석자 실명

```text
좋음: DEC-012 시드 데이터 파이프라인 순서 확정 (owner: @GoBeromsu)
나쁨: [회의록 7/15] "OOO 교수님 말씀대로 8월 행사 전에..." (본문 인용)
```

## 유출 사고 절차

1. 발견 즉시 @Lumiere001에게 보고한다. 스스로 조용히 지우고 넘어가지 않는다.
2. 시크릿이면 즉시 해당 키를 회전(rotate)한다. 회전이 삭제보다 먼저다.
3. 개인정보면 history rewrite + GitHub Support 캐시 제거 요청을 진행하고, 당사자 고지 필요 여부를 판단한다.

## gh 토큰

에이전트·스크립트가 쓰는 GitHub 토큰은 fine-grained PAT로 발급한다.

- 대상 repo: oss-hub 단일 repo로 제한
- 권한: Read-only 권장. 쓰기가 필요한 자동화만 최소 범위로 별도 발급
- classic PAT(전체 repo 접근)는 사용하지 않는다

## 위반 탐지

PR 리뷰에서 deny-list 8종과 `/Users/` 경로, 한글 실명 패턴을 확인한다. 기여자가 자신의 Git 설정으로 선택한 author·committer identity 이메일은 위반으로 보지 않는다. gitleaks + 커스텀 regex lint 도입 후에는 CI 실패로 자동 차단하며, lint를 우회한 merge는 유출 사고 절차를 따른다.
