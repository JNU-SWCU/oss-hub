#!/usr/bin/env bash
# PR 본문이 SPEC(`.github/pull_request_template.md`)의 절 순서·제목·예외 문구 계약을 지키는지
# 기계적으로 검사한다.
#
# 리뷰어가 매번 같은 것("화면 캡처 어딨나", "다이어그램 없네")을 요청하게 만드는 절 누락은
# 사람이 눈으로 잡기엔 반복 비용이 크다. 이 검사는 그 반복을 파일 검사와
# `gh pr create`/`gh pr edit` 훅 양쪽에서 fail-closed로 대신 막는다.
#
# 사용:
#   scripts/check-pr-body.sh <본문 파일>   # 파일 검사. 통과 0 / 위반 1 / 사용 오류 2
#   scripts/check-pr-body.sh --hook        # stdin으로 Claude Code PreToolUse JSON을 받아
#                                           # gh pr create / gh pr edit 를 가로챈다
set -euo pipefail

# macOS 기본 /usr/bin/awk(one true awk)는 UTF-8 로케일에서 문자열 `==` 비교에 locale
# collation을 타 바이트 길이가 같은 서로 다른 한글 문자열(예: "## 검증" vs "## 정리")을
# 같다고 판정하는 결함이 있다 — 이 스크립트의 모든 절 경계·판정값 비교가 그 비교에
# 의존하므로, 상속받은 로케일과 무관하게 바이트 단위 비교가 되도록 C로 고정한다.
export LC_ALL=C

# 절 제목(H2) — 이 순서로, 이 문자열과 글자 단위로 같아야 한다.
# 첫 줄(Closes/티켓 없음)은 R2가 따로 검사하므로 여기 포함하지 않는다.
HEADINGS=(
  "무엇이 좋아지나"
  "바로 확인"
  "Before / After"
  "이 흐름이 자연스러운가"
  "내가 고친 UX 문제"
  "UX 안티패턴 점검"
  "흐름 다이어그램"
  "검증"
  "정리"
)

violations=()

# "## <제목>" 절 본문(다음 "## " 줄 또는 파일 끝까지)을 추출한다.
section_body() {
  local file=$1 heading=$2
  awk -v target="## $heading" '
    $0 == target { found=1; next }
    found && /^## / { found=0 }
    found { print }
  ' "$file"
}

# 절 본문에 예외 문구(줄 시작)가 있는지 검사한다.
has_exemption() {
  local body=$1 prefix=$2
  grep -qE "^${prefix}" <<<"$body"
}

# `.github/pull_request_template.md`의 안내용 HTML 주석(단일·여러 줄)을 전부 지운다.
#
# GitHub 웹 UI에서 PR을 열 때 템플릿의 안내 주석을 지우지 않고 그 밑에 내용만 채우는 경우가
# 흔하다. 그 주석을 실제 본문과 같은 텍스트로 보면 "검증 절이 비어 있지 않다"거나 "예외
# 문구가 없다" 같은 판정이 주석 안의 예시 문구·설명 때문에 잘못 나온다. 그래서 R8·R9를
# 제외한 모든 규칙은 주석을 지운 사본에 대해서만 판정한다 — R8(로컬 경로 금지)과 R9
# (자리표시자 금지)는 반대로 주석 자체가 검사 대상(예: 주석에 남은 로컬 캡처 경로,
# `<!-- 첨부 대기`)이므로 원본을 그대로 쓴다.
strip_html_comments() {
  local file=$1
  awk '
    {
      line = $0
      out = ""
      while (length(line) > 0) {
        if (in_comment) {
          pos = index(line, "-->")
          if (pos > 0) {
            line = substr(line, pos + 3)
            in_comment = 0
          } else {
            line = ""
          }
        } else {
          pos = index(line, "<!--")
          if (pos > 0) {
            out = out substr(line, 1, pos - 1)
            line = substr(line, pos + 4)
            in_comment = 1
          } else {
            out = out line
            line = ""
          }
        }
      }
      print out
    }
  ' "$file"
}

# ---- R1: 절 제목 9개(H2)가 순서대로 전부 있다(Closes 줄까지 세면 열 개) ------------
check_headings() {
  local file=$1
  local missing=() lines=() h line_no prev order_ok

  for h in "${HEADINGS[@]}"; do
    line_no=$(grep -nFx "## $h" "$file" | head -n1 | cut -d: -f1 || true)
    if [[ -z "$line_no" ]]; then
      missing+=("$h")
    fi
    lines+=("${line_no:-0}")
  done

  if ((${#missing[@]} > 0)); then
    local joined
    joined=$(IFS=', '; echo "${missing[*]}")
    violations+=("R1 절 제목이 없다: $joined")
    return
  fi

  prev=0
  order_ok=1
  for line_no in "${lines[@]}"; do
    if ((line_no <= prev)); then
      order_ok=0
      break
    fi
    prev=$line_no
  done
  if ((order_ok == 0)); then
    violations+=("R1 절 제목 순서가 지정된 순서와 다르다")
  fi
}

# ---- R2: 첫 비어 있지 않은 줄 -------------------------------------------------
check_first_line() {
  local file=$1 first_line
  first_line=$(awk '/[^[:space:]]/ { sub(/^[ \t]+/, ""); print; exit }' "$file")

  if [[ "$first_line" =~ ^Closes\ \#[0-9]+ ]]; then
    return
  fi
  if [[ "$first_line" == "티켓 없음 — "* ]]; then
    return
  fi
  violations+=("R2 첫 줄이 'Closes #<번호>' 또는 '티켓 없음 — <이유>' 형식이 아니다: ${first_line:-(비어 있음)}")
}

# ---- R3: 바로 확인 ------------------------------------------------------------
check_quick_check() {
  local file=$1 body
  body=$(section_body "$file" "바로 확인")
  if grep -qF "https://jnu-oss-hub.com/" <<<"$body"; then
    return
  fi
  if has_exemption "$body" "확인 링크 없음 — "; then
    return
  fi
  violations+=("R3 '바로 확인' 절에 확인 링크(https://jnu-oss-hub.com/)나 예외 문구가 없다")
}

# ---- R4: Before / After --------------------------------------------------------
check_before_after() {
  local file=$1 body
  body=$(section_body "$file" "Before / After")
  if grep -qE '<img|!\[' <<<"$body"; then
    if ! grep -qF '| 요소 |' <<<"$body"; then
      violations+=("R4 'Before / After' 절에 이미지는 있지만 '| 요소 |' 헤더 행이 없다")
    fi
    return
  fi
  if has_exemption "$body" "Before/After 없음 — "; then
    return
  fi
  violations+=("R4 'Before / After' 절에 이미지도 예외 문구도 없다")
}

# ---- R11: '이 흐름이 자연스러운가'·'내가 고친 UX 문제' 절이 비어 있지 않다 -------------
# 두 절 다 예외 문구("화면 없음 — <이유>")도 실제 내용으로 친다 — 그 문구 자체가
# "화면을 보지 않았다"를 명시적으로 밝히는 유효한 답이다.
check_ux_narrative_sections() {
  local file=$1 heading body
  for heading in "이 흐름이 자연스러운가" "내가 고친 UX 문제"; do
    body=$(section_body "$file" "$heading")
    if ! grep -qE '[^[:space:]]' <<<"$body"; then
      violations+=("R11 '$heading' 절이 비어 있다 — 화면을 보고 쓰거나 \`화면 없음 — <이유>\`로 적는다")
    fi
  done
}

# ---- R5: UX 안티패턴 점검 -------------------------------------------------------
check_ux_antipatterns() {
  local file=$1 body n missing=() no_evidence
  body=$(section_body "$file" "UX 안티패턴 점검")

  if has_exemption "$body" "UX 안티패턴 해당 없음 — "; then
    return
  fi

  for n in $(seq 1 20); do
    if ! grep -qE "^\| *AP-${n} " <<<"$body"; then
      missing+=("AP-$n")
    fi
  done
  if ((${#missing[@]} > 0)); then
    local joined
    joined=$(IFS=', '; echo "${missing[*]}")
    violations+=("R5 'UX 안티패턴 점검' 절에 없는 행: $joined")
  fi

  no_evidence=$(awk -F'|' '
    /^\| *AP-[0-9]+ / {
      verdict = $3; evidence = $4;
      gsub(/^[ \t]+|[ \t]+$/, "", verdict);
      gsub(/^[ \t]+|[ \t]+$/, "", evidence);
      if (verdict == "통과") {
        name = $2;
        gsub(/^[ \t]+|[ \t]+$/, "", name);
        print name;
      }
    }
  ' <<<"$body")
  if [[ -n "$no_evidence" ]]; then
    while IFS= read -r name; do
      violations+=("R5 근거 없는 통과 행: $name")
    done <<<"$no_evidence"
  fi
}

# ---- R6: 흐름 다이어그램 --------------------------------------------------------
check_flow_diagram() {
  local file=$1 body
  body=$(section_body "$file" "흐름 다이어그램")
  if grep -qF '```mermaid' <<<"$body" || grep -qF '```dot' <<<"$body"; then
    return
  fi
  if has_exemption "$body" "흐름 다이어그램 없음 — "; then
    return
  fi
  violations+=("R6 '흐름 다이어그램' 절에 mermaid/dot 코드 블록도 예외 문구도 없다")
}

# ---- R7: 검증 -------------------------------------------------------------------
check_verification() {
  local file=$1 body
  body=$(section_body "$file" "검증")
  if ! grep -qE '[^[:space:]]' <<<"$body"; then
    violations+=("R7 '검증' 절이 비어 있다")
  fi
}

# ---- R8: 로컬 경로 금지 · 이미지는 https:// -------------------------------------
check_paths_and_images() {
  local file=$1 hits src url img

  # `-n`(줄번호 접두) + `cut -d: -f2`는 매치 자체에 `:`가 들어있는 `file://`를 "file"로
  # 잘라버렸다 — 줄번호 없이 매치 텍스트만 그대로 뽑는다.
  hits=$(grep -oE 'file://|/Users/|/home/|/tmp/|/private/' "$file" | sort -u | tr '\n' ' ' || true)
  if [[ -n "${hits// /}" ]]; then
    violations+=("R8 본문에 로컬/파일 경로가 있다: ${hits% }")
  fi

  while IFS= read -r src; do
    [[ -z "$src" ]] && continue
    url=${src#src=\"}
    url=${url%\"}
    [[ -z "$url" ]] && continue # 빈 src는 R9가 자리표시자로 잡는다
    if [[ "$url" != https://* ]]; then
      violations+=("R8 이미지 src가 https:// 로 시작하지 않는다: $url")
    fi
  done < <(grep -oE 'src="[^"]*"' "$file")

  while IFS= read -r img; do
    [[ -z "$img" ]] && continue
    url=$(sed -E 's/.*\(([^)]*)\)/\1/' <<<"$img")
    [[ -z "$url" ]] && continue # 빈 괄호는 R9가 자리표시자로 잡는다
    if [[ "$url" != https://* ]]; then
      violations+=("R8 마크다운 이미지 링크가 https:// 로 시작하지 않는다: $url")
    fi
  done < <(grep -oE '!\[[^]]*\]\([^)]*\)' "$file")
}

# ---- R9: 자리표시자 금지 ---------------------------------------------------------
check_placeholders() {
  local file=$1
  grep -qF '<!-- 첨부 대기' "$file" && violations+=("R9 자리표시자가 남아있다: <!-- 첨부 대기")
  # `TODO:` 또는 줄이 (선행 `- ` 포함) TODO 하나뿐인 경우만 잡는다 — 「남은 TODO 정리는
  # 별도 이슈로」 같은 산문 속 TODO는 자리표시자가 아니므로 잡지 않는다.
  grep -qE 'TODO:|^[[:space:]]*(-[[:space:]]*)?TODO([[:space:]]|$)' "$file" \
    && violations+=("R9 자리표시자가 남아있다: TODO")
  # `<img>`는 다른 속성(width·alt 등)이 src보다 먼저 올 수 있으므로 태그 어디든 src=""면 잡는다.
  grep -qE '<img[^>]*src=""' "$file" && violations+=("R9 자리표시자가 남아있다: <img src=\"\">")
  # 마크다운 이미지는 alt 텍스트가 있어도 괄호(공백만 포함)가 비어 있으면 자리표시자다.
  grep -qE '!\[[^]]*\]\([[:space:]]*\)' "$file" && violations+=("R9 자리표시자가 남아있다: ![]()")
  return 0
}

# ---- R10: 정리 체크박스 넷 전부 [x] ----------------------------------------------
check_summary_checklist() {
  local file=$1 body count line
  body=$(section_body "$file" "정리")
  count=$(grep -cE '^- \[[ xX]\]' <<<"$body" || true)

  # 넷 미만이면 필수 체크박스가 빠진 것이지만, 넷을 넘는 것은(프로젝트별 추가 항목)
  # 허용한다 — 아래 all-checked 루프가 초과분까지 포함해 전부 체크됐는지 계속 검사한다.
  if [[ "$count" -lt 4 ]]; then
    violations+=("R10 '정리' 절 체크박스가 4개가 아니다: ${count}개")
    return
  fi

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    if [[ "$line" != "- [x]"* ]]; then
      violations+=("R10 체크되지 않은 항목: $line")
    fi
  done < <(grep -E '^- \[[ xX]\]' <<<"$body")
}

# ---- 파일 전체 검사 --------------------------------------------------------------
check_file() {
  local file=$1
  violations=()

  local stripped
  stripped=$(mktemp "${TMPDIR:-/tmp}/check-pr-body-stripped.XXXXXX")
  trap 'rm -f "$stripped"' RETURN
  strip_html_comments "$file" >"$stripped"

  check_headings "$stripped"
  check_first_line "$stripped"
  check_quick_check "$stripped"
  check_before_after "$stripped"
  check_ux_narrative_sections "$stripped"
  check_ux_antipatterns "$stripped"
  check_flow_diagram "$stripped"
  check_verification "$stripped"
  check_paths_and_images "$file" # R8도 주석 속 로컬 경로를 잡아야 하므로 원본을 쓴다
  check_placeholders "$file" # R9는 주석 자체가 위반 대상이므로 원본을 쓴다
  check_summary_checklist "$stripped"

  if ((${#violations[@]} == 0)); then
    echo "pr-body: ok"
    return 0
  fi

  local v
  for v in "${violations[@]}"; do
    echo "pr-body: $v" >&2
  done
  echo "pr-body: ${#violations[@]}건 위반" >&2
  return 1
}

# ---- --hook: gh pr create / gh pr edit 를 가로챈다 -------------------------------

hook_reject() {
  echo "pr-body: $1" >&2
  exit 2
}

# 명령 문자열에서 플래그 토큰(공백/시작 경계, 공백·`=`·쉘 구분자·끝 경계)이 있는지 검사한다.
# 닫는 경계에 `;&|)`도 포함해 `(gh pr create --fill)`, `gh pr create --fill;` 처럼
# 공백 없이 쉘 메타문자가 바로 붙는 경우도 놓치지 않는다.
has_token() {
  local cmd=$1 flag=$2
  grep -qE "(^|[[:space:]])${flag}([[:space:]=;&|)]|\$)" <<<"$cmd"
}

run_hook() {
  local input tool_name command match action body_file

  input=$(cat)
  if [[ -z "$input" ]]; then
    exit 0
  fi

  # 입력에 'gh'가 아예 없으면 node를 띄우지 않고 즉시 통과시킨다 — Bash 호출마다 매번
  # node 프로세스 두 개(tool_name, command)를 띄우던 비용을 없앤다.
  grep -qF 'gh' <<<"$input" || exit 0

  # node가 없으면 이 훅은 아무 검사도 할 수 없다 — 조용히 통과(exit 0)시키면 실제로는
  # fail-open이 되므로, gh가 언급된 입력은 대신 fail-closed로 막는다(Node ≥24는 저장소
  # 필수 도구이므로 정상 환경에서는 발생하지 않는다).
  if ! command -v node >/dev/null 2>&1; then
    echo "pr-body: node를 찾을 수 없다 — PR 본문 검사를 할 수 없어 fail-closed로 막는다(Node ≥24는 저장소 필수 도구다)" >&2
    exit 2
  fi

  # tool_name과 command를 한 번의 node 프로세스에서 NUL로 구분해 함께 뽑는다(이전에는
  # node를 두 번 띄웠다). 명령 문자열에 개행이 섞여 있을 수 있으므로(예: 여러 줄
  # heredoc) 줄바꿈이 아니라 NUL로 분리해서 읽는다.
  local -a fields
  mapfile -d '' -t fields < <(printf '%s' "$input" | node -e '
let d = "";
process.stdin.on("data", (c) => { d += c; });
process.stdin.on("end", () => {
  try {
    const j = JSON.parse(d);
    const toolName = typeof j.tool_name === "string" ? j.tool_name : "";
    const c = j.tool_input && j.tool_input.command;
    const command = typeof c === "string" ? c : "";
    process.stdout.write("ok\u0000" + toolName + "\u0000" + command + "\u0000");
  } catch (e) {
    process.stdout.write("error\u0000\u0000\u0000");
  }
});
')

  if [[ "${fields[0]:-error}" != "ok" ]]; then
    echo "pr-body: hook 입력 JSON을 읽지 못했다 — 검사 없이 통과시킨다" >&2
    exit 0
  fi
  tool_name=${fields[1]:-}
  command=${fields[2]:-}

  if [[ "$tool_name" != "Bash" ]]; then
    exit 0
  fi

  if [[ -z "$command" ]]; then
    exit 0
  fi

  # gh pr create / gh pr edit 언급이 없으면 관여하지 않는다. 과잉 매칭보다 과소 매칭이 낫다.
  # `gh`는 명령 시작이거나 쉘 구분자(`;&|(`) 뒤(공백 0개 이상)에 와야 한다 — 그냥 공백만으로는
  # 매칭하지 않아 `git commit -m "fix: gh pr create flow"`처럼 인용 문자열 속 언급은 피한다.
  match=$(grep -oE '(^|[;&|(])[[:space:]]*gh[[:space:]]+pr[[:space:]]+(create|edit)([[:space:]]|$)' <<<"$command" | head -n1) || true
  if [[ -z "$match" ]]; then
    exit 0
  fi

  # --help 는 관여하지 않는다. `-h`는 다른 명령의 무관한 플래그(예: `du -h`)와 겹치므로
  # 더 이상 별도 인지하지 않는다.
  if has_token "$command" '--help'; then
    exit 0
  fi

  if grep -qE 'pr[[:space:]]+edit' <<<"$match"; then
    action=edit
  else
    action=create
  fi

  # gh pr edit 는 본문을 바꾸는 플래그가 있을 때만 관여한다.
  if [[ "$action" == "edit" ]]; then
    if ! has_token "$command" '(--body-file|-F|--body|-b)'; then
      exit 0
    fi
  fi

  if has_token "$command" '--fill'; then
    hook_reject "PR 본문은 파일로 만들어 --body-file 로 넘긴다 — submit-pr-evidence 절차를 먼저 수행하라(skills/submit-pr-evidence/SKILL.md)"
  fi

  if has_token "$command" '(--body|-b)'; then
    hook_reject "PR 본문은 파일로 만들어 --body-file 로 넘긴다 — submit-pr-evidence 절차를 먼저 수행하라(skills/submit-pr-evidence/SKILL.md)"
  fi

  # 값이 따옴표로 감싸인 경우(공백이 든 경로)와 `--body-file=`/`-F` 형태를 모두 받는다.
  # `set -euo pipefail` 아래에서 매칭이 없으면 grep이 1로 종료해 스크립트가 메시지 없이
  # 죽었던 버그가 있었다 — `|| true`로 파이프라인을 항상 성공시키고, 그 결과 body_file이
  # 비면 아래 분기가 hook_reject로 넘어가 exit 2와 메시지를 함께 낸다.
  body_file=$(grep -oE -- '(--body-file|-F)[[:space:]=]+("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]+)' <<<"$command" \
    | head -n1 \
    | sed -E 's/^(--body-file|-F)[[:space:]=]+//; s/^"(.*)"$/\1/; s/^'\''(.*)'\''$/\1/') || true

  if [[ -z "$body_file" ]]; then
    hook_reject "PR 본문은 파일로 만들어 --body-file 로 넘긴다 — submit-pr-evidence 절차를 먼저 수행하라(skills/submit-pr-evidence/SKILL.md)"
  fi

  if [[ ! -f "$body_file" ]]; then
    hook_reject "PR 본문 파일을 찾을 수 없다: $body_file"
  fi

  if check_file "$body_file"; then
    exit 0
  fi
  exit 2
}

main() {
  if [[ "${1:-}" == "--hook" ]]; then
    run_hook
    return
  fi

  if [[ $# -ne 1 ]]; then
    echo "pr-body: 사용법: check-pr-body.sh <본문 파일> | check-pr-body.sh --hook" >&2
    exit 2
  fi

  local file=$1
  if [[ ! -f "$file" ]]; then
    echo "pr-body: 본문 파일을 찾을 수 없다: $file" >&2
    exit 2
  fi

  if check_file "$file"; then
    exit 0
  fi
  exit 1
}

main "$@"
