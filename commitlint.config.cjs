// AGENTS.md §5 — 형식은 Conventional Commits v1.0.0을 따르되, type은
// 이 repo가 쓰는 7종(feat/fix/docs/refactor/test/chore/ci)만 허용한다.
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'ci'],
    ],
    // subject-case는 영어 대소문자 규칙이라 AGENTS.md §5의 "요약은 한국어 한 줄"과
    // 맞물리지 않는다. 한국어에는 case가 없어 대부분 무동작이고, 제목이 `TEAM-STATE`·
    // `DATABASE_URL`처럼 ASCII 대문자 식별자로 **시작할 때만** upper-case로 오판한다.
    // 의미 이득 없이 어순 변경만 강요하므로 끈다. type-enum은 §5가 명시한 계약이라 남긴다.
    'subject-case': [0],
  },
};
