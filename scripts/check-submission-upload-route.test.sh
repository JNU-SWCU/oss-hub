#!/usr/bin/env bash
set -euo pipefail

# check-submission-upload-route.sh 합성 fixture 회귀 테스트 (G004 D6).
# 실제 nginx·시크릿·실데이터 없이 경로 계약만 고정한다.

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
checker="$repo_root/scripts/check-submission-upload-route.sh"
source_config="$repo_root/deploy/nginx/nginx.conf"
fixture_dir=$(mktemp -d "${TMPDIR:-/tmp}/submission-upload-route.XXXXXX")
trap 'rm -rf "$fixture_dir"' EXIT

passed=0
failed=0

expect_pass() {
  local name=$1 path=$2
  if "$checker" "$path" >/dev/null 2>&1; then
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  else
    printf 'not ok - %s\n' "$name" >&2
    failed=$((failed + 1))
  fi
}

expect_fail() {
  local name=$1 path=$2
  if "$checker" "$path" >/dev/null 2>&1; then
    printf 'not ok - %s (실패해야 하지만 성공)\n' "$name" >&2
    failed=$((failed + 1))
  else
    printf 'ok - %s\n' "$name"
    passed=$((passed + 1))
  fi
}

write_fixture() {
  local name=$1
  cat >"$fixture_dir/$name"
}

# 최소 유효 계약 fixture (repo 원본 의존 없이 양성 기준을 고정)
write_fixture valid <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 403;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 주석으로 설명만 있고 유효 deny 는 유지 → 통과해야 한다
write_fixture valid-with-comments <<'EOF'
server {
    listen 80;
    # location = /api/v1/submission-files { return 200; }
    location = /api/v1/submission-files {
        return 403; # deny upload until off-host backup
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# exact path deny 누락 → /api/v1/submission-files 가 /api/ 로 프록시됨
write_fixture missing-exact <<'EOF'
server {
    listen 80;
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# trailing-slash/subpath deny 누락 → /api/v1/submission-files/ 우회
write_fixture missing-trailing-prefix <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# exact 블록이 다시 proxy 하면 fail-closed 위반
write_fixture exact-still-proxies <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        proxy_pass http://backend:4000;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 2xx return 은 fail-closed 가 아니다
write_fixture exact-returns-2xx <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 200;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 3xx redirect 는 클라이언트를 프록시 경로로 보낼 수 있어 fail-closed 가 아니다
write_fixture exact-returns-3xx <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 302 /api/v1/other;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# prefix 가 3xx 이면 동일하게 거절
write_fixture prefix-returns-3xx <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 403;
    }
    location ^~ /api/v1/submission-files/ {
        return 308 /api/v1/other/;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 4xx 이지만 403 이 아닌 상태도 계약 위반 (의도된 deny 는 403)
write_fixture exact-returns-404 <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 404;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# /api/ 과차단 — 무관한 API 까지 막으면 안 된다
write_fixture api-overblock <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 403;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        return 403;
    }
}
EOF

# bare prefix 는 submission-filesXYZ 등 sibling 경로까지 삼킨다
write_fixture bare-prefix-overmatch <<'EOF'
server {
    listen 80;
    location ^~ /api/v1/submission-files {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# malformed: return 문 없음
write_fixture missing-return <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        deny all;
    }
    location ^~ /api/v1/submission-files/ {
        deny all;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# deny 블록이 전부 주석 처리되면 유효 구성에 deny 가 없다
write_fixture fully-commented-denies <<'EOF'
server {
    listen 80;
    # location = /api/v1/submission-files {
    #     return 403;
    # }
    # location ^~ /api/v1/submission-files/ {
    #     return 403;
    # }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 인라인 주석으로 location 헤더만 남긴 형태도 유효 deny 가 아니다
write_fixture inline-commented-denies <<'EOF'
server {
    listen 80;
    #location = /api/v1/submission-files { return 403; }
    #location ^~ /api/v1/submission-files/ { return 403; }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# deny 블록 안 proxy_pass 혼재
write_fixture prefix-still-proxies <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 403;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
        proxy_pass http://backend:4000;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 동일 location 중복 선언
write_fixture duplicate-exact <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 403;
    }
    location = /api/v1/submission-files {
        return 403;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# --- adversarial: 조건부·중첩·인용 문자열 우회 ---

# if 조건부 return 만 있으면 무조건 top-level 403 이 아니다
write_fixture conditional-return <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        if ($request_method = POST) {
            return 403;
        }
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 중첩 블록 안의 return 만 있고 최상위 무조건 return 이 없다
write_fixture nested-block-return <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        limit_except GET {
            return 403;
        }
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 여러 줄 문자열 안의 지시어처럼 보이는 텍스트는 무시되어야 하며,
# 실제 top-level return 이 없으면 실패한다 (문자열만으로 통과 불가)
write_fixture multiline-directive-looking-strings <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        add_header X-Note "return 403;
        proxy_pass http://backend:4000;";
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 문자열 속 중괄호가 brace depth 를 깨뜨려 본문 추출을 속이지 못하게 한다
write_fixture braces-in-strings <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        add_header X-Note "not a block { return 200; }";
        proxy_pass http://backend:4000;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 인용된 # 뒤에 오는 실제 proxy_pass 는 주석이 아니다 → deny 위반
write_fixture quoted-hash-then-proxy <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        add_header X-Note "has # inside"; proxy_pass http://backend:4000;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# /api/ 에 가짜 proxy 문자열만 있고 실제 proxy_pass 지시어가 없다
write_fixture fake-api-proxy-string <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 403;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        add_header X-Note "proxy_pass http://backend:4000";
    }
}
EOF

# /api/ 한 줄에 proxy 와 차단 return 이 같이 있으면 과차단
write_fixture api-same-line-blocking-return <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 403;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000; return 403;
    }
}
EOF

# 세미콜론으로 한 줄에 묶인 지시어 — exact 가 proxy 를 숨기면 실패
write_fixture semicolon-packed-proxy <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        add_header X-Note "ok"; proxy_pass http://backend:4000; add_header X-B "y";
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 유효: 세미콜론 묶음이어도 top-level return 403 과 backend proxy 가 실지시어면 통과
write_fixture semicolon-packed-valid <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files { return 403; }
    location ^~ /api/v1/submission-files/ { return 403; }
    location /api/ { proxy_pass http://backend:4000; }
}
EOF

# 유효: 인용 # 과 중괄호 문자열이 있어도 실지시어 계약이 유지되면 통과
write_fixture quoted-noise-valid <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        add_header X-Note "literal # and { braces }; return 200;";
        return 403;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        add_header X-Note "proxy_pass http://evil:9";
        proxy_pass http://backend:4000;
    }
}
EOF

# prefix 중복
write_fixture duplicate-prefix <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 403;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# nested proxy bypass — top-level return 이 있어도 nested proxy 는 우회 가능
write_fixture nested-proxy-bypass <<'EOF'
server {
    listen 80;
    location = /api/v1/submission-files {
        return 403;
        if ($request_method = GET) {
            proxy_pass http://backend:4000;
        }
    }
    location ^~ /api/v1/submission-files/ {
        return 403;
    }
    location /api/ {
        proxy_pass http://backend:4000;
    }
}
EOF

# 원본 repo 설정도 계약 충족 (배포 대상 실파일)
cp "$source_config" "$fixture_dir/repo-config"

missing_path="$fixture_dir/does-not-exist.conf"

expect_pass '합성 유효 fail-closed 계약' "$fixture_dir/valid"
expect_pass '주석 설명 포함 유효 계약' "$fixture_dir/valid-with-comments"
expect_pass 'repo compose nginx 제출 경로 fail-closed 계약' "$fixture_dir/repo-config"
expect_pass '세미콜론 묶음 유효 계약' "$fixture_dir/semicolon-packed-valid"
expect_pass '인용 노이즈 포함 유효 계약' "$fixture_dir/quoted-noise-valid"
expect_fail 'exact path deny 누락' "$fixture_dir/missing-exact"
expect_fail 'trailing-slash/subpath deny 누락' "$fixture_dir/missing-trailing-prefix"
expect_fail 'exact path 가 여전히 proxy' "$fixture_dir/exact-still-proxies"
expect_fail 'exact path 2xx return' "$fixture_dir/exact-returns-2xx"
expect_fail 'exact path 3xx redirect' "$fixture_dir/exact-returns-3xx"
expect_fail 'prefix path 3xx redirect' "$fixture_dir/prefix-returns-3xx"
expect_fail 'exact path 404 return' "$fixture_dir/exact-returns-404"
expect_fail '무관한 /api/ 과차단' "$fixture_dir/api-overblock"
expect_fail 'bare prefix sibling over-match' "$fixture_dir/bare-prefix-overmatch"
expect_fail 'return 없는 malformed deny' "$fixture_dir/missing-return"
expect_fail '전부 주석 처리된 deny 블록' "$fixture_dir/fully-commented-denies"
expect_fail '인라인 주석 처리된 deny 블록' "$fixture_dir/inline-commented-denies"
expect_fail 'prefix deny 가 여전히 proxy' "$fixture_dir/prefix-still-proxies"
expect_fail 'duplicate exact location' "$fixture_dir/duplicate-exact"
expect_fail '설정 파일 부재' "$missing_path"
expect_fail '조건부 if return only' "$fixture_dir/conditional-return"
expect_fail '중첩 블록 return only' "$fixture_dir/nested-block-return"
expect_fail 'multiline 지시어 위장 문자열 only' "$fixture_dir/multiline-directive-looking-strings"
expect_fail '문자열 braces 로 proxy 위장' "$fixture_dir/braces-in-strings"
expect_fail '인용 # 뒤 실제 proxy' "$fixture_dir/quoted-hash-then-proxy"
expect_fail '가짜 API proxy 문자열' "$fixture_dir/fake-api-proxy-string"
expect_fail 'API 한 줄 blocking return' "$fixture_dir/api-same-line-blocking-return"
expect_fail '세미콜론 묶음 proxy deny' "$fixture_dir/semicolon-packed-proxy"
expect_fail 'duplicate prefix location' "$fixture_dir/duplicate-prefix"
expect_fail 'nested proxy bypass' "$fixture_dir/nested-proxy-bypass"

printf '%s passed, %s failed\n' "$passed" "$failed"
((failed == 0))
