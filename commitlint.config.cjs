// AGENTS.md §5 — 형식은 Conventional Commits v1.0.0을 따르되, type은
// 이 repo가 쓰는 7종(feat/fix/docs/refactor/test/chore/ci)만 허용한다.
module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      ["feat", "fix", "docs", "refactor", "test", "chore", "ci"],
    ],
  },
};
