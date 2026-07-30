#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCANNER="$ROOT/scripts/check-public-safe.sh"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/public-safe-email-test.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT

# 완성된 이메일 literal을 저장소에 남기지 않고 실행 시점에만 합성한다.
allowed_noreply='noreply'"@"'synthetic.local'
allowed_reserved='fixture'"@"'sub.example.com'
allowed_reserved_upper='FIXTURE'"@"'SYNTHETIC.INVALID'
blocked_contact='contact'"@"'synthetic.local'
blocked_lookalike='contact'"@"'notexample.com'
blocked_test_lookalike='contact'"@"'test.co'
at_sign="$(printf '\100')"
blocked_eai_local="합성${at_sign}synthetic.invalid"
blocked_quoted_eai_local="\"합성 ascii\"${at_sign}synthetic.invalid"
blocked_quoted_escaped_eai_local='"합성\" ascii"'"${at_sign}"'synthetic.invalid'
blocked_quoted_ascii_contact='"synthetic local"'"${at_sign}"'notexample.com'
blocked_unicode_domain="fixture${at_sign}합성.invalid"
blocked_punycode_domain="fixture${at_sign}xn--synthetic.invalid"
blocked_name='-SyntheticName'
mixed_same_line="$allowed_noreply $blocked_contact"
git_identity="$allowed_noreply"

# GitHub @handle 멘션 오탐 회귀 — 도메인 형태(점 + 마지막 점 뒤 2자 이상)가 없어
# 이메일 후보가 될 수 없는 문장들. 리터럴 그대로 써도 이메일처럼 보이지 않는다.
mention_bullet_dot='@GoBeromsu·@Lumiere001의 free-role 예외'
mention_paren_comma='사람은 GitHub @handle로만 표기했다(@GoBeromsu, @Lumiere001)'
mention_quoted_sentence='"PM+Tech Lead 이중 승인"에서 "@GoBeromsu 단독"으로 바뀐다'
mention_backtick_var='`@${TECH_LEAD_ACTOR}의 TECH_LEAD_ACCEPT`'
mention_shell_assignment_ellipsis="셸 문자열(var='${at_sign}handle...' 형태)"
mention_dotless_unicode_token="담당자${at_sign}내부도메인"
mention_quoted_dotless_token='"quoted local"'"${at_sign}"'내부도메인'

# 도메인 형태 요건 도입 후에도 계속 차단돼야 하는 실제 이메일류 — 소스에 완성된
# literal이 남지 않도록 at_sign으로 쪼갠다.
blocked_kr_tld_email="사용자${at_sign}example.co.kr"
blocked_quoted_local_dotted_domain='"quoted local"'"${at_sign}"'example.com'
blocked_punycode_ascii_domain="admin${at_sign}xn--80ak6aa92e.com"
blocked_unicode_local_and_domain="테스트${at_sign}도메인.한국"

# 독립 보안 리뷰가 재현한 회귀 3건과 스스로 구성한 반례 — local part의 구분자 제외를
# 되돌리고 도메인 쪽에만 걸었는지, 점 없는 도메인도 갈래 B로 잡는지 확인한다.
# 가운뎃점 케이스는 도메인에 점을 둔다: local part 끝의 구분자로 판별하면
# "@GoBeromsu·@Lumiere001" 같은 정상 멘션(mention_bullet_dot)과 문자 단위로
# 구분이 불가능해, 점 있는 도메인(갈래 A, local part 내용과 무관하게 잡힘)으로만
# 안전하게 재현할 수 있다.
blocked_backtick_local_dotted_domain='담당자`'"${at_sign}"'example.com'
blocked_bullet_dot_before_at_dotted_domain="관리자·${at_sign}example.com"
blocked_paren_wrapped_dotted_domain="(사용자${at_sign}example.com)"
blocked_hangul_domain_locale="문의${at_sign}걷기example.com"

passed=0
failed=0

expect_pass() {
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$label"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected pass)\n' "$label"
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local label="$1"
  local status=0
  shift
  "$@" >/dev/null 2>&1 || status=$?
  if [ "$status" -eq 1 ]; then
    printf 'ok - %s\n' "$label"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected exit 1, got %s)\n' "$label" "$status"
    failed=$((failed + 1))
  fi
}

expect_error() {
  local label="$1" expected="$2" status=0
  shift 2
  "$@" >/dev/null 2>&1 || status=$?
  if [ "$status" -eq "$expected" ]; then
    printf 'ok - %s\n' "$label"
    passed=$((passed + 1))
  else
    printf 'not ok - %s (expected exit %s, got %s)\n' \
      "$label" "$expected" "$status"
    failed=$((failed + 1))
  fi
}

scan_pr_text() {
  (
    cd "$ROOT"
    PR_TEXT="$1" bash "$SCANNER" HEAD
  )
}

scan_invalid_ref() {
  (
    cd "$ROOT"
    PR_TEXT='' bash "$SCANNER" refs/heads/missing-public-safe-base
  )
}

scan_issue_text() {
  (
    cd "$ROOT"
    ISSUE_TEXT="$1" bash "$SCANNER" --text-only
  )
}

# 로케일 불변성 확인 — bracket expression 안의 가운뎃점 리터럴이 비UTF-8 로케일에서
# 바이트 단위로 쪼개지는 결함을 스크립트가 스스로 UTF-8 로케일을 고정해 막는지 검증한다.
# 외부에서 LC_ALL=C를 강제해도 스캐너 내부의 로케일 고정이 우선해야 같은 결과가 나온다.
scan_issue_text_lc_all_c() {
  (
    cd "$ROOT"
    LC_ALL=C ISSUE_TEXT="$1" bash "$SCANNER" --text-only
  )
}

scan_issue_text_ignores_missing_ref() {
  (
    cd "$ROOT"
    ISSUE_TEXT="$1" bash "$SCANNER" --text-only refs/heads/missing-public-safe-base
  )
}

scan_issue_blocked_name() {
  (
    cd "$ROOT"
    BLOCKED_NAMES="$blocked_name" ISSUE_TEXT="$blocked_name" \
      bash "$SCANNER" --text-only
  )
}

scan_broken_grep() {
  local bin="$TEMP_ROOT/broken-grep"
  mkdir -p "$bin"
  printf '#!/usr/bin/env bash\nexit 2\n' >"$bin/grep"
  chmod +x "$bin/grep"
  (
    cd "$ROOT"
    PATH="$bin:$PATH" PR_TEXT="$blocked_contact" bash "$SCANNER" HEAD
  )
}

scan_blocked_name() {
  (
    cd "$ROOT"
    BLOCKED_NAMES="$blocked_name" PR_TEXT="$blocked_name" \
      bash "$SCANNER" HEAD
  )
}

workflow_omits_blocked_names_secret() {
  local status=0
  grep -Fq 'secrets.BLOCKED_NAMES' "$ROOT/.github/workflows/ci.yml" || status=$?
  [ "$status" -eq 1 ]
}

expect_blocked_redacted() {
  local output status=0
  output="$(scan_pr_text "$blocked_contact" 2>&1)" || status=$?
  if [ "$status" -eq 1 ] \
    && [[ "$output" != *"$blocked_contact"* ]] \
    && [[ "$output" == *"line 1"* ]]; then
    printf 'ok - 차단값을 로그에 원문 출력하지 않음\n'
    passed=$((passed + 1))
  else
    printf 'not ok - 차단값 로그 redaction\n'
    failed=$((failed + 1))
  fi
}

expect_forbidden_path_redacted() {
  local output status=0
  output="$(scan_fixture_repo 2>&1)" || status=$?
  if [ "$status" -eq 1 ] \
    && [[ "$output" =~ path-id:[0-9a-f]{40} ]] \
    && [[ "$output" != *"forged-annotation"* ]]; then
    printf 'ok - 제어문자 파일 경로를 안전한 식별자로 대체\n'
    passed=$((passed + 1))
  else
    printf 'not ok - 제어문자 파일 경로 redaction\n'
    failed=$((failed + 1))
  fi
}

init_fixture_repo() {
  FIXTURE_REPO="$TEMP_ROOT/$1"
  mkdir -p "$FIXTURE_REPO/scripts"
  cp "$SCANNER" "$FIXTURE_REPO/scripts/check-public-safe.sh"
  git -C "$FIXTURE_REPO" init -q
  printf 'synthetic baseline\n' >"$FIXTURE_REPO/README.md"
  git -C "$FIXTURE_REPO" add README.md scripts/check-public-safe.sh
  git -C "$FIXTURE_REPO" \
    -c user.name='Synthetic Contributor' \
    -c user.email="$git_identity" \
    commit -qm 'test: synthetic baseline'
  BASE_REF="$(git -C "$FIXTURE_REPO" rev-parse HEAD)"
}

commit_fixture() {
  git -C "$FIXTURE_REPO" \
    -c user.name='Synthetic Contributor' \
    -c user.email="$git_identity" \
    "$@"
}

scan_fixture_repo() {
  (
    cd "$FIXTURE_REPO"
    PR_TEXT='' bash scripts/check-public-safe.sh "$BASE_REF"
  )
}

expect_pass 'noreply 주소만 있는 PR 텍스트' \
  scan_pr_text "$allowed_noreply"
expect_pass 'RFC 2606 예약 예시 주소만 있는 PR 텍스트' \
  scan_pr_text "$allowed_reserved"
expect_pass '대문자 RFC 2606 예약 주소만 있는 PR 텍스트' \
  scan_pr_text "$allowed_reserved_upper"
expect_fail '금지 합성 연락처 주소만 있는 PR 텍스트' \
  scan_pr_text "$blocked_contact"
expect_fail '예약 도메인 유사 이름인 PR 텍스트' \
  scan_pr_text "$blocked_lookalike"
expect_fail '예약 TLD 유사 이름인 PR 텍스트' \
  scan_pr_text "$blocked_test_lookalike"
expect_fail 'EAI local-part 이메일 후보를 보수적으로 차단' \
  scan_pr_text "$blocked_eai_local"
expect_fail '공백을 포함한 quoted EAI local-part를 보수적으로 차단' \
  scan_pr_text "$blocked_quoted_eai_local"
expect_fail 'escaped quote가 있는 quoted EAI local-part를 보수적으로 차단' \
  scan_pr_text "$blocked_quoted_escaped_eai_local"
expect_fail 'quoted ASCII 연락처 후보를 보수적으로 차단' \
  scan_pr_text "$blocked_quoted_ascii_contact"
expect_fail 'Unicode domain 이메일 후보를 보수적으로 차단' \
  scan_pr_text "$blocked_unicode_domain"
expect_fail 'punycode IDN 이메일 후보를 연락처로 차단' \
  scan_pr_text "$blocked_punycode_domain"
expect_fail '허용·금지 주소가 같은 줄인 PR 텍스트' \
  scan_pr_text "$mixed_same_line"

expect_pass '가운뎃점으로 이어진 GitHub 멘션 두 개(도메인 형태 없음)' \
  scan_pr_text "$mention_bullet_dot"
expect_pass '괄호·쉼표로 감싼 GitHub 멘션들(도메인 형태 없음)' \
  scan_pr_text "$mention_paren_comma"
expect_pass '따옴표 문장 뒤 GitHub 멘션(quoted-local 오매칭 방지)' \
  scan_pr_text "$mention_quoted_sentence"
expect_pass '백틱·쉘 변수 뒤 GitHub 멘션(도메인 형태 없음)' \
  scan_pr_text "$mention_backtick_var"
expect_pass '셸 할당문 속 GitHub 핸들 뒤 말줄임표' \
  scan_pr_text "$mention_shell_assignment_ellipsis"
expect_pass '점 없는 Unicode 토큰은 자동 이메일 후보에서 제외' \
  scan_pr_text "$mention_dotless_unicode_token"
expect_pass 'quoted local과 점 없는 토큰은 자동 이메일 후보에서 제외' \
  scan_pr_text "$mention_quoted_dotless_token"

expect_fail '도메인 형태 요건 도입 후에도 차단되는 .co.kr 이메일' \
  scan_pr_text "$blocked_kr_tld_email"
expect_fail '도메인 형태 요건 도입 후에도 차단되는 quoted-local 이메일' \
  scan_pr_text "$blocked_quoted_local_dotted_domain"
expect_fail '도메인 형태 요건 도입 후에도 차단되는 punycode 이메일' \
  scan_pr_text "$blocked_punycode_ascii_domain"
expect_fail '도메인 형태 요건 도입 후에도 차단되는 비ASCII local·domain 이메일' \
  scan_pr_text "$blocked_unicode_local_and_domain"

# local part 구분자 제외를 되돌린 뒤에도 아래 회귀·반례가 계속 차단되는지 확인한다.
expect_fail '백틱이 @ 바로 앞에 오는 비ASCII local + 점 있는 도메인' \
  scan_pr_text "$blocked_backtick_local_dotted_domain"
expect_fail '가운뎃점이 @ 바로 앞에 오고 도메인에 점이 있는 경우' \
  scan_pr_text "$blocked_bullet_dot_before_at_dotted_domain"
expect_fail '여는 괄호로 감싼 전체 주소(도메인에 점이 있음)' \
  scan_pr_text "$blocked_paren_wrapped_dotted_domain"
expect_fail '외부 LC_ALL=C 환경에서도 한글 도메인 이메일 차단(스캐너 자체 로케일 고정)' \
  scan_issue_text_lc_all_c "$blocked_hangul_domain_locale"

expect_error '존재하지 않는 기준 ref' 2 scan_invalid_ref
expect_error 'grep 실행 오류' 2 scan_broken_grep
expect_fail '하이픈으로 시작하는 BLOCKED_NAMES 값' scan_blocked_name
expect_pass 'PR workflow에 BLOCKED_NAMES secret 미주입' \
  workflow_omits_blocked_names_secret
expect_blocked_redacted

expect_pass 'noreply 주소만 있는 Issue 본문·댓글 텍스트' \
  scan_issue_text "$allowed_noreply"
expect_fail '금지 합성 연락처 주소만 있는 Issue 본문·댓글 텍스트' \
  scan_issue_text "$blocked_contact"
expect_fail '허용·금지 주소가 같은 줄인 Issue 본문·댓글 텍스트' \
  scan_issue_text "$mixed_same_line"
expect_fail 'text-only 모드에서도 BLOCKED_NAMES 검사 적용' \
  scan_issue_blocked_name
expect_pass 'text-only 모드는 기준 ref 인자 없이도 통과 (git diff·커밋 메시지 스캔 생략)' \
  scan_issue_text_ignores_missing_ref "$allowed_noreply"

init_fixture_repo changed-file
printf '%s\n' "$mixed_same_line" >"$FIXTURE_REPO/synthetic-fixture.txt"
git -C "$FIXTURE_REPO" add synthetic-fixture.txt
commit_fixture commit -qm 'test: synthetic changed-file fixture'
expect_fail '허용·금지 주소가 같은 줄인 변경 파일' scan_fixture_repo

init_fixture_repo commit-message
commit_fixture commit --allow-empty -qm "$mixed_same_line"
expect_fail '허용·금지 주소가 같은 줄인 커밋 메시지' scan_fixture_repo

init_fixture_repo changed-symlink
ln -s "$blocked_contact" "$FIXTURE_REPO/synthetic-link"
git -C "$FIXTURE_REPO" add synthetic-link
commit_fixture commit -qm 'test: synthetic symlink fixture'
expect_fail '금지 주소가 target인 변경 symlink' scan_fixture_repo

init_fixture_repo changed-korean-path
printf '%s\n' "$blocked_contact" >"$FIXTURE_REPO/합성-경로.md"
git -C "$FIXTURE_REPO" add '합성-경로.md'
commit_fixture commit -qm 'test: synthetic Korean path fixture'
expect_fail '한글 경로의 금지 주소가 있는 변경 파일' scan_fixture_repo

init_fixture_repo test-source
cp "$ROOT/scripts/check-public-safe.test.sh" \
  "$FIXTURE_REPO/scripts/check-public-safe.test.sh"
git -C "$FIXTURE_REPO" add scripts/check-public-safe.test.sh
commit_fixture commit -qm 'test: synthetic regression source'
expect_pass '회귀 테스트 소스 자체 public-safe 검사' scan_fixture_repo

init_fixture_repo forbidden-upper-env
printf 'synthetic config\n' >"$FIXTURE_REPO/.ENV"
git -C "$FIXTURE_REPO" add .ENV
commit_fixture commit -qm 'test: uppercase env path fixture'
expect_fail '대문자 .ENV 파일 경로' scan_fixture_repo

init_fixture_repo forbidden-upper-env-example
printf 'SYNTHETIC_KEY=placeholder\n' >"$FIXTURE_REPO/.ENV.EXAMPLE"
git -C "$FIXTURE_REPO" add .ENV.EXAMPLE
commit_fixture commit -qm 'test: uppercase env example path fixture'
expect_fail '비정규 대문자 .ENV.EXAMPLE 파일 경로' scan_fixture_repo

init_fixture_repo allowed-canonical-env-example
printf 'SYNTHETIC_KEY=placeholder\n' >"$FIXTURE_REPO/.env.example"
git -C "$FIXTURE_REPO" add .env.example
commit_fixture commit -qm 'test: canonical env example path fixture'
expect_pass '정규 소문자 .env.example 파일 경로' scan_fixture_repo

init_fixture_repo control-character-path
control_dir=$'synthetic\n::error::forged-annotation'
mkdir -p "$FIXTURE_REPO/$control_dir"
printf 'synthetic config\n' >"$FIXTURE_REPO/$control_dir/.ENV"
git -C "$FIXTURE_REPO" add -- "$control_dir/.ENV"
commit_fixture commit -qm 'test: control character path fixture'
expect_forbidden_path_redacted

init_fixture_repo forbidden-credentials-note
printf 'synthetic note\n' >"$FIXTURE_REPO/credentials.md"
git -C "$FIXTURE_REPO" add credentials.md
commit_fixture commit -qm 'test: credentials note fixture'
expect_fail '자격증명 메모 파일 경로(credentials.md)' scan_fixture_repo

init_fixture_repo forbidden-secrets-yaml
printf 'synthetic: placeholder\n' >"$FIXTURE_REPO/secrets.yaml"
git -C "$FIXTURE_REPO" add secrets.yaml
commit_fixture commit -qm 'test: secrets yaml fixture'
expect_fail '자격증명 메모 파일 경로(secrets.yaml)' scan_fixture_repo

init_fixture_repo forbidden-private-key-under-secrets
mkdir -p "$FIXTURE_REPO/secrets"
printf 'synthetic placeholder\n' >"$FIXTURE_REPO/secrets/leak.pem"
git -C "$FIXTURE_REPO" add secrets/leak.pem
commit_fixture commit -qm 'test: committed private key path fixture'
expect_fail '커밋된 개인키 파일 경로(secrets/leak.pem)' scan_fixture_repo

init_fixture_repo forbidden-credentials-suffixed
mkdir -p "$FIXTURE_REPO/docs"
printf 'synthetic note\n' >"$FIXTURE_REPO/docs/credentials-prod.md"
git -C "$FIXTURE_REPO" add docs/credentials-prod.md
commit_fixture commit -qm 'test: suffixed credentials note fixture'
expect_fail '접미사 붙은 자격증명 메모 경로(docs/credentials-prod.md)' scan_fixture_repo

# 오탐 경계: 이름에 credential 이 들어가도 소스 파일과 정책 문서는 막지 않는다.
init_fixture_repo allowed-credential-like-source
mkdir -p "$FIXTURE_REPO/src" "$FIXTURE_REPO/docs/rules"
printf 'export const noop = 1;\n' >"$FIXTURE_REPO/src/credentials.service.ts"
printf '# 시크릿 취급 정책\n\n합성 문서입니다.\n' >"$FIXTURE_REPO/docs/rules/security.md"
git -C "$FIXTURE_REPO" add src/credentials.service.ts docs/rules/security.md
commit_fixture commit -qm 'test: credential-like source fixture'
expect_pass '자격증명 유사 이름의 소스·정책 문서는 허용' scan_fixture_repo

printf 'tests=%s passed=%s failed=%s\n' \
  "$((passed + failed))" "$passed" "$failed"

[ "$failed" -eq 0 ]
