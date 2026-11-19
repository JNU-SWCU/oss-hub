#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCANNER="$ROOT/.github/check-public-safe.sh"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/public-safe-test.XXXXXX")"
trap 'rm -rf "$TEMP_ROOT"' EXIT

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

blocked_student_id_like='20'"$(printf '%07d' 1)"
merge_head_sha='eca42ea847a58497965dd26c7a95a0e1348eed8a'
merge_base_sha='ec3b0d1d5648c205e397003dfe0b2'"055235"'37c61'
synthetic_merge_ref_message="Merge ${merge_head_sha} into ${merge_base_sha}"

mention_bullet_dot='@GoBeromsu·@Lumiere001의 free-role 예외'
mention_paren_comma='사람은 GitHub @handle로만 표기했다(@GoBeromsu, @Lumiere001)'
mention_quoted_sentence='"PM+Tech Lead 이중 승인"에서 "@GoBeromsu 단독"으로 바뀐다'
mention_backtick_var="\`@\${TECH_LEAD_ACTOR}의 TECH_LEAD_ACCEPT\`"
mention_shell_assignment_ellipsis="셸 문자열(var='${at_sign}handle...' 형태)"
mention_dotless_unicode_token="담당자${at_sign}내부도메인"
mention_quoted_dotless_token='"quoted local"'"${at_sign}"'내부도메인'

blocked_kr_tld_email="사용자${at_sign}example.co.kr"
blocked_quoted_local_dotted_domain='"quoted local"'"${at_sign}"'example.com'
blocked_punycode_ascii_domain="admin${at_sign}xn--80ak6aa92e.com"
blocked_unicode_local_and_domain="테스트${at_sign}도메인.한국"

blocked_backtick_local_dotted_domain='담당자`'"${at_sign}"'example.com'
blocked_bullet_dot_before_at_dotted_domain="관리자·${at_sign}example.com"
blocked_paren_wrapped_dotted_domain="(사용자${at_sign}example.com)"
blocked_hangul_domain_locale="문의${at_sign}걷기example.com"

passed=0
failed=0

expect_pass() { expect_status 0 "$@"; }
expect_fail() { expect_status 1 "$@"; }

expect_status() {
  local expected="$1" label="$2" status=0
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
  local output status=0 other_name='OtherSynthetic'
  output="$(cd "$ROOT" && BLOCKED_NAMES=" $blocked_name , $other_name " \
    ISSUE_TEXT="$blocked_name"$'\n'"$other_name" bash "$SCANNER" --text-only 2>&1)" || status=$?
  [ "$status" -eq 1 ] && [[ "$output" == *$'  line 1\n  line 2'* ]] \
    && [[ "$output" != *"$blocked_name"* && "$output" != *"$other_name"* ]] || return 2
  return 1
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

workflow_isolates_public_input() {
  local status=0
  # Security configuration: public workflow code must never receive this secret.
  grep -Eq 'BLOCKED_NAMES|github\.event\.(pull_request|issue|comment).*(title|body)' \
    "$ROOT"/.github/workflows/*.yml || status=$?
  [ "$status" -eq 1 ]
}

scan_surface() {
  local surface="$1" sample="$2" output patch_output status=0 event=issues leaks=0
  case "$surface" in
    commit-subject | commit-body | merge-subject | merge-body | file)
      init_fixture_repo "surface-$((passed + failed))" || return 2
      case "$surface" in
        commit-subject) commit_fixture commit --allow-empty -qm "$sample" || return 2 ;;
        commit-body) commit_fixture commit --allow-empty -qm 'test: synthetic message' -m "$sample" || return 2 ;;
        merge-*)
          commit_fixture checkout -qb synthetic-feature || return 2
          commit_fixture commit --allow-empty -qm 'test: synthetic feature' || return 2
          commit_fixture checkout -q - || return 2
          if [ "$surface" = merge-subject ]; then
            commit_fixture merge --no-ff -qm "$sample" synthetic-feature || return 2
          else
            commit_fixture merge --no-ff -qm 'test: synthetic merge' -m "$sample" synthetic-feature || return 2
          fi
          ;;
        file)
          printf '%s\n' "$sample" >"$FIXTURE_REPO/synthetic.txt"
          git -C "$FIXTURE_REPO" add synthetic.txt || return 2
          commit_fixture commit -qm 'test: synthetic file' || return 2
          ;;
      esac
      output="$(BLOCKED_NAMES="$blocked_name" scan_fixture_repo 2>&1)" || status=$?
      if [ "$surface" = file ] && [ "$status" -eq 0 ]; then
        # Only the credential fixture and allow controls still need the patch scan.
        patch_output="$(cd "$FIXTURE_REPO" && gitleaks git --no-banner --redact \
          --exit-code 3 --log-opts="$BASE_REF..HEAD" . 2>&1)" || leaks=$?
        output+=$'\n'"$patch_output"
        case "$leaks" in
          0) ;;
          3) status=1 ;;
          *) return 2 ;;
        esac
      fi
      ;;
    *)
      case "$surface" in
        pull_request.*) event=pull_request ;;
        comment.*) event=issue_comment ;;
      esac
      jq -n --arg field "$surface" --arg value "$sample" \
        'setpath($field | split("."); $value)' >"$TEMP_ROOT/event.json" || return 2
      output="$(cd "$ROOT" && BLOCKED_NAMES="$blocked_name" \
        GITHUB_EVENT_NAME="$event" GITHUB_EVENT_PATH="$TEMP_ROOT/event.json" \
        bash "$SCANNER" --event HEAD 2>&1)" || status=$?
      ;;
  esac
  # A leaked fixture is a test error even when the scanner correctly rejects it.
  [[ "$output" != *"$sample"* ]] || return 2
  return "$status"
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
  mkdir -p "$FIXTURE_REPO/.github" || return 2
  cp "$SCANNER" "$FIXTURE_REPO/.github/check-public-safe.sh" || return 2
  git -C "$FIXTURE_REPO" init -q || return 2
  printf 'synthetic baseline\n' >"$FIXTURE_REPO/README.md" || return 2
  git -C "$FIXTURE_REPO" add README.md .github/check-public-safe.sh || return 2
  git -C "$FIXTURE_REPO" \
    -c user.name='Synthetic Contributor' \
    -c user.email="$git_identity" \
    commit -qm 'test: synthetic baseline' || return 2
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
    PR_TEXT='' bash .github/check-public-safe.sh "$BASE_REF"
  )
}

# 정책: 공통 표면 매트릭스 외의 이메일 경계
expect_pass '대문자 RFC 2606 예약 주소만 있는 PR 텍스트' \
  scan_pr_text "$allowed_reserved_upper"
expect_fail '예약 도메인 유사 이름인 PR 텍스트' \
  scan_pr_text "$blocked_lookalike"
expect_fail '예약 TLD 유사 이름인 PR 텍스트' \
  scan_pr_text "$blocked_test_lookalike"
expect_fail '공백을 포함한 quoted EAI local-part를 보수적으로 차단' \
  scan_pr_text "$blocked_quoted_eai_local"
expect_fail 'escaped quote가 있는 quoted EAI local-part를 보수적으로 차단' \
  scan_pr_text "$blocked_quoted_escaped_eai_local"
expect_fail 'Unicode domain 이메일 후보를 보수적으로 차단' \
  scan_pr_text "$blocked_unicode_domain"
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

expect_fail '백틱이 @ 바로 앞에 오는 비ASCII local + 점 있는 도메인' \
  scan_pr_text "$blocked_backtick_local_dotted_domain"
expect_fail '가운뎃점이 @ 바로 앞에 오고 도메인에 점이 있는 경우' \
  scan_pr_text "$blocked_bullet_dot_before_at_dotted_domain"
expect_fail '여는 괄호로 감싼 전체 주소(도메인에 점이 있음)' \
  scan_pr_text "$blocked_paren_wrapped_dotted_domain"
expect_fail '외부 LC_ALL=C 환경에서도 한글 도메인 이메일 차단(스캐너 자체 로케일 고정)' \
  scan_issue_text_lc_all_c "$blocked_hangul_domain_locale"

expect_pass '공개 workflow에 deny-list secret 및 원문 이벤트 env 미주입' \
  workflow_isolates_public_input
for root in Users private tmp; do
  expect_fail "단일 하위 요소의 로컬 경로: $root" \
    scan_pr_text "$(printf '/%s/%s' "$root" synthetic)"
done
expect_fail '설정값의 임시 경로 차단' \
  scan_pr_text "$(printf 'output=/%s/%s' tmp synthetic)"
expect_pass '공개 URL 안의 tmp 경로 허용' \
  scan_pr_text 'output=https://example.org/tmp/synthetic'
expect_fail '허용·금지 주소가 같은 줄인 Issue 본문·댓글 텍스트' \
  scan_issue_text "$mixed_same_line"
expect_fail 'text-only 모드에서 하이픈을 포함한 deny-list 이름들의 행만 한 번 보고' \
  scan_issue_blocked_name

init_fixture_repo changed-file
printf '%s\n' "$mixed_same_line" >"$FIXTURE_REPO/synthetic-fixture.txt"
git -C "$FIXTURE_REPO" add synthetic-fixture.txt
commit_fixture commit -qm 'test: synthetic changed-file fixture'
expect_fail '허용·금지 주소가 같은 줄인 변경 파일' scan_fixture_repo

init_fixture_repo commit-message
commit_fixture commit --allow-empty -qm "$mixed_same_line"
expect_fail '커밋 메시지의 이메일 후보 차단' scan_fixture_repo

init_fixture_repo synthetic-merge-ref
commit_fixture checkout -qb feature-branch
printf 'synthetic feature change\n' >"$FIXTURE_REPO/feature.txt"
git -C "$FIXTURE_REPO" add feature.txt
commit_fixture commit -qm 'test: synthetic feature commit'
commit_fixture checkout -q -
commit_fixture merge --no-ff -q -m "$synthetic_merge_ref_message" feature-branch
expect_pass '합성 merge ref의 해시 전용 제목 숫자열 오탐 방지' \
  scan_fixture_repo

# 실행 안전성: 오류 전파, 입력 경계, 원문 비노출
expect_status 2 '존재하지 않는 기준 ref' scan_invalid_ref
expect_status 2 'grep 실행 오류' scan_broken_grep
expect_blocked_redacted
expect_pass 'text-only 모드는 git 범위 검사를 생략' \
  scan_issue_text_ignores_missing_ref "$allowed_noreply"

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
cp "$ROOT/.github/check-public-safe.test.sh" \
  "$FIXTURE_REPO/.github/check-public-safe.test.sh"
git -C "$FIXTURE_REPO" add .github/check-public-safe.test.sh
commit_fixture commit -qm 'test: synthetic regression source'
expect_pass '회귀 테스트 소스 자체 public-safe 검사' scan_fixture_repo

init_fixture_repo control-character-path
control_dir=$'synthetic\n::error::forged-annotation'
mkdir -p "$FIXTURE_REPO/$control_dir"
printf 'synthetic config\n' >"$FIXTURE_REPO/$control_dir/.ENV"
git -C "$FIXTURE_REPO" add -- "$control_dir/.ENV"
commit_fixture commit -qm 'test: control character path fixture'
expect_forbidden_path_redacted

init_fixture_repo binary-image-with-email-bytes
printf 'RIFF\000\000WEBP %s\000\001' "$blocked_contact" >"$FIXTURE_REPO/shot.webp"
git -C "$FIXTURE_REPO" add shot.webp
commit_fixture commit -qm 'test: binary image fixture'
expect_pass 'NUL을 포함한 이미지 바이너리는 본문 검사를 건너뛴다' scan_fixture_repo

init_fixture_repo text-with-nul-and-email
printf 'note\000 %s\n' "$blocked_contact" >"$FIXTURE_REPO/note.txt"
git -C "$FIXTURE_REPO" add note.txt
commit_fixture commit -qm 'test: text file with NUL fixture'
expect_fail 'NUL이 있는 텍스트 파일은 계속 검사한다' scan_fixture_repo

init_fixture_repo image-extension-without-nul
printf 'plain %s\n' "$blocked_contact" >"$FIXTURE_REPO/fake.webp"
git -C "$FIXTURE_REPO" add fake.webp
commit_fixture commit -qm 'test: image extension without NUL fixture'
expect_fail 'NUL 없는 .webp는 계속 검사한다' scan_fixture_repo

# 정책: 내용이 비어 있어도 파일명 자체를 검사한다.
scan_empty_file() {
  local path="$1"
  init_fixture_repo "empty-file-$((passed + failed))" || return 2
  mkdir -p "$FIXTURE_REPO/$(dirname "$path")" || return 2
  touch "$FIXTURE_REPO/$path" || return 2
  git -C "$FIXTURE_REPO" add -- "$path" || return 2
  commit_fixture commit -qm 'test: empty file fixture' || return 2
  scan_fixture_repo
}

for path in .ENV .ENV.EXAMPLE credentials.md secrets.yaml secrets/leak.pem \
  docs/credentials-prod.md id_ed25519 .netrc synthetic.db; do
  expect_fail "빈 금지 파일: $path" scan_empty_file "$path"
done
expect_pass '정규 env 예시 파일' scan_empty_file .env.example
expect_pass '자격증명과 유사한 소스 파일명' scan_empty_file src/credentials.service.ts
expect_pass '보안 정책 문서 파일명' scan_empty_file docs/rules/security.md

# Same runtime event-file path as Actions, plus real committed messages and files.
# Never put fixture values in labels, shell tracing, or hosted event payloads.
surface_samples=(
  "$blocked_contact" "$blocked_quoted_ascii_contact" "$blocked_eai_local"
  "$blocked_punycode_domain"
  "$(printf '/%s/%s' home synthetic)" "$(printf '%s\\%s\\%s' C: Users synthetic)"
  "$blocked_name" "$(printf '%s.%s' synthetic internal)"
  "$(printf '%s://open?vault=synthetic' obsidian)"
  "000101-1$(printf '%06d' 1)" "010-0000-$(printf '%04d' 1)"
  "$blocked_student_id_like" 'ghp_'"aB3dE5fG7hJ9kL2mN4pQ6rS8tV0wX1yZ3bC5"
)
for surface in pull_request.title pull_request.body issue.title issue.body comment.body \
  commit-subject commit-body merge-subject merge-body file; do
  for i in "${!surface_samples[@]}"; do
    expect_fail "전면 차단·비노출: $surface case $i" \
      scan_surface "$surface" "${surface_samples[$i]}"
  done
  for sample in synthetic-control "$allowed_noreply" "$allowed_reserved"; do
    expect_pass "안전한 입력 허용: $surface" scan_surface "$surface" "$sample"
  done
done

printf 'tests=%s passed=%s failed=%s\n' \
  "$((passed + failed))" "$passed" "$failed"

[ "$failed" -eq 0 ]
