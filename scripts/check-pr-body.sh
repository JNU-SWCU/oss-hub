#!/usr/bin/env bash
set -euo pipefail

export LC_ALL=C

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

section_body() {
  local file=$1 heading=$2
  awk -v target="## $heading" '
    $0 == target { found=1; next }
    found && /^## / { found=0 }
    found { print }
  ' "$file"
}

has_exemption() {
  local body=$1 prefix=$2
  grep -qE "^${prefix}.*[^[:space:]]" <<<"$body"
}

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

check_first_line() {
  local file=$1 first_line
  first_line=$(awk '/[^[:space:]]/ { sub(/^[ \t]+/, ""); print; exit }' "$file")

  if [[ "$first_line" =~ ^(Closes|Refs)\ \#[0-9]+ ]]; then
    return
  fi
  if has_exemption "$first_line" "티켓 없음 — "; then
    return
  fi
  violations+=("R2 첫 줄이 'Closes #<번호>', 'Refs #<번호>' 또는 '티켓 없음 — <이유>' 형식이 아니다: ${first_line:-(비어 있음)}")
}

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

check_before_after() {
  local file=$1 body rendered image_count
  body=$(section_body "$file" "Before / After")
  if grep -qE '^비시각 브라우저 변경 —' <<<"$body"; then
    rendered=$(awk '
      /^[[:space:]]*(```|~~~)/ { fenced=!fenced; next }
      !fenced { print }
    ' <<<"$body")
    has_exemption "$rendered" "비시각 브라우저 변경 — " \
      || violations+=("R4 비시각 브라우저 변경의 사유가 비어 있다")
    awk '
      header && /^\|[[:space:]]*:?-{3,}:?[[:space:]]*\|[[:space:]]*:?-{3,}:?[[:space:]]*\|[[:space:]]*:?-{3,}:?[[:space:]]*\|[[:space:]]*$/ { found=1 }
      { header=($0 ~ /^\|[[:space:]]*동작[[:space:]]*\|[[:space:]]*Before[[:space:]]*\|[[:space:]]*After[[:space:]]*\|[[:space:]]*$/) }
      END { exit !found }
    ' <<<"$rendered" \
      || violations+=("R4 비시각 브라우저 변경에 동작·Before·After 헤더와 구분선이 없다")
    image_count=$({ grep -oE '<img[[:space:]][^>]*src="https://[^"[:space:]]+"|!\[[^]]*\]\(https://[^)[:space:]]+\)' <<<"$rendered" || true; } | wc -l)
    [[ "$image_count" -ge 2 ]] \
      || violations+=("R4 비시각 브라우저 변경에 HTTPS Before/After 이미지 두 장이 없다")
    return
  fi
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

check_ux_narrative_sections() {
  local file=$1 heading body
  for heading in "이 흐름이 자연스러운가" "내가 고친 UX 문제"; do
    body=$(section_body "$file" "$heading")
    if ! grep -qE '[^[:space:]]' <<<"$body"; then
      violations+=("R11 '$heading' 절이 비어 있다 — 화면을 보고 쓰거나 \`화면 없음 — <이유>\`로 적는다")
    elif grep -qE '^화면 없음 — ' <<<"$body" && ! has_exemption "$body" "화면 없음 — "; then
      violations+=("R11 '$heading' 절의 '화면 없음' 예외 이유가 비어 있다")
    fi
  done
}

check_ux_antipatterns() {
  local file=$1 body n missing=() no_evidence
  body=$(section_body "$file" "UX 안티패턴 점검")

  if has_exemption "$body" "UX 안티패턴 해당 없음 — "; then
    return
  fi

  for n in $(seq 1 24); do
    if ! grep -qE "^\| *AP-${n} " <<<"$body"; then
      missing+=("AP-$n")
    fi
  done
  if ((${#missing[@]} > 0)); then
    local joined
    joined=$(printf '%s, ' "${missing[@]}")
    joined=${joined%, }
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

check_verification() {
  local file=$1 body
  body=$(section_body "$file" "검증")
  if ! grep -qE '[^[:space:]]' <<<"$body"; then
    violations+=("R7 '검증' 절이 비어 있다")
  fi
}

check_paths_and_images() {
  local file=$1 hits src url img

  hits=$(grep -oE 'file://|/Users/|/home/|/tmp/|/private/' "$file" | sort -u | tr '\n' ' ' || true)
  if [[ -n "${hits// /}" ]]; then
    violations+=("R8 본문에 로컬/파일 경로가 있다: ${hits% }")
  fi

  while IFS= read -r src; do
    [[ -z "$src" ]] && continue
    url=${src#src=\"}
    url=${url%\"}
    [[ -z "$url" ]] && continue
    if [[ "$url" != https://* ]]; then
      violations+=("R8 이미지 src가 https:// 로 시작하지 않는다: $url")
    fi
  done < <(grep -oE 'src="[^"]*"' "$file")

  while IFS= read -r img; do
    [[ -z "$img" ]] && continue
    url=$(sed -E 's/.*\(([^)]*)\)/\1/' <<<"$img")
    [[ -z "$url" ]] && continue
    if [[ "$url" != https://* ]]; then
      violations+=("R8 마크다운 이미지 링크가 https:// 로 시작하지 않는다: $url")
    fi
  done < <(grep -oE '!\[[^]]*\]\([^)]*\)' "$file")
}

check_placeholders() {
  local file=$1
  grep -qF '<!-- 첨부 대기' "$file" && violations+=("R9 자리표시자가 남아있다: <!-- 첨부 대기")
  grep -qE 'TODO:|^[[:space:]]*(-[[:space:]]*)?TODO([[:space:]]|$)' "$file" \
    && violations+=("R9 자리표시자가 남아있다: TODO")
  grep -qE '<img[^>]*src=""' "$file" && violations+=("R9 자리표시자가 남아있다: <img src=\"\">")
  grep -qE '!\[[^]]*\]\([[:space:]]*\)' "$file" && violations+=("R9 자리표시자가 남아있다: ![]()")
  return 0
}

check_summary_checklist() {
  local file=$1 body count line
  body=$(section_body "$file" "정리")
  count=$(grep -cE '^- \[[ xX]\]' <<<"$body" || true)

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

check_design_spec() {
  local file=$1 body line value
  body=$(section_body "$file" "정리")
  line=$(grep -E '^- 디자인 규격:' <<<"$body" | head -n 1 || true)
  if [[ -z "$line" ]]; then
    violations+=("R12 '정리' 절에 '- 디자인 규격:' 줄이 없다 — 쓴 공용 컴포넌트·토큰과 규격 출처(공용 컴포넌트 경로, docs/design-tokens/tokens.json 또는 Figma 링크)를 적거나 \`화면 변경 없음 — <이유>\`로 적는다")
    return
  fi
  value=${line#- 디자인 규격:}
  value=${value#"${value%%[![:space:]]*}"}
  if [[ -z "$value" ]]; then
    violations+=("R12 디자인 규격 줄이 비어 있다")
  elif grep -qE '<[^>]*>' <<<"$value"; then
    violations+=("R12 디자인 규격 줄에 템플릿 자리표시자가 남아 있다: $line")
  elif [[ "$value" == "화면 변경 없음"* ]] && ! grep -qE '^화면 변경 없음 — .*[^[:space:]]' <<<"$value"; then
    violations+=("R12 디자인 규격 줄의 '화면 변경 없음' 예외 이유가 비어 있다")
  fi
}

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
  check_paths_and_images "$file"
  check_placeholders "$file"
  check_summary_checklist "$stripped"
  check_design_spec "$stripped"

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


hook_reject() {
  echo "pr-body: $1" >&2
  exit 2
}

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

  grep -qF 'gh' <<<"$input" || exit 0

  if ! command -v node >/dev/null 2>&1; then
    echo "pr-body: node를 찾을 수 없다 — PR 본문 검사를 할 수 없어 fail-closed로 막는다(Node ≥24는 저장소 필수 도구다)" >&2
    exit 2
  fi

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

  match=$(grep -oE '(^|[;&|(])[[:space:]]*gh[[:space:]]+pr[[:space:]]+(create|edit)([[:space:]]|$)' <<<"$command" | head -n1) || true
  if [[ -z "$match" ]]; then
    exit 0
  fi

  if has_token "$command" '--help'; then
    exit 0
  fi

  if grep -qE 'pr[[:space:]]+edit' <<<"$match"; then
    action=edit
  else
    action=create
  fi

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
