// AGENTS.md §5 — 형식은 Conventional Commits v1.0.0을 따르되, type은
// 이 repo가 쓰는 8종(feat/fix/docs/refactor/style/test/chore/ci)만 허용한다.
//
// `style`은 나중에 들어왔다. 규칙에 없던 이 type으로 커밋된 이력이 이미
// 저장소에 있었고(`fdf9941`), 그 사실이 규칙과 현실이 어긋나 있었음을 보여 준다.
// 되돌리려면 그 뒤 800개가 넘는 커밋을 다시 써야 하는데, 그 커밋은 다른 PR의
// 브랜치도 가리키고 있어 강제 푸시가 남의 작업을 무너뜨린다. 규칙 쪽을 현실에
// 맞추는 편이 위험이 작다고 판단했다(2026-08-02, 사용자 결정).
//
// Conventional Commits 가 정의하는 `style`은 **동작에 영향이 없는 표기 변경**이다
// — 공백·줄바꿈·따옴표처럼 코드가 하는 일이 그대로인 것. 코드가 하는 일은 같지만
// 구조를 손봤다면 `style`이 아니라 `refactor`다.
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'docs', 'refactor', 'style', 'test', 'chore', 'ci'],
    ],
    // subject-case는 영어 대소문자 규칙이라 AGENTS.md §5의 "요약은 한국어 한 줄"과
    // 맞물리지 않는다. 한국어에는 case가 없어 대부분 무동작이고, 제목이 `TEAM-STATE`·
    // `DATABASE_URL`처럼 ASCII 대문자 식별자로 **시작할 때만** upper-case로 오판한다.
    // 의미 이득 없이 어순 변경만 강요하므로 끈다. type-enum은 §5가 명시한 계약이라 남긴다.
    'subject-case': [0],
  },
};
