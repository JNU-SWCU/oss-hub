# 로그인 이력 보존 정책

- `LoginHistory`는 로그인·로그아웃 시각, GitHub provider, 성공 여부만 저장한다. IP와 User-Agent는 수집하지 않는다.
- 보존 기간은 `loginAt` 기준 1년이다.
- 1년이 지난 행을 삭제하는 정기 batch는 이 모듈에 포함하지 않고 후속 운영 작업으로 구현한다.
