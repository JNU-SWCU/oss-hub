import { expect, test } from '@playwright/test';

import { e2eEnvironment } from './environment';

// Chrome은 페이지의 <link rel="icon"> 지정과 무관하게 브라우저 프로세스
// 레벨에서 /favicon.ico를 별도로, 그리고 비동기·비결정적 타이밍에 프로브한다.
// 이 요청은 Playwright의 page.on('request')/page.on('response')에 잡히지
// 않는데 — CDP Network 이벤트 스트림을 타지 않기 때문이다 — 실패하면
// page.on('console')에만 "Failed to load resource: ... 404" 로 나타나고,
// 이 메시지는 URL을 담지 않는다. admin-access-lifecycle.spec.ts에서 원인
// 불명의 간헐적 콘솔 404로 관측됐던 것이 바로 이 요청이었다. app/icon.svg만
// 있고 app/favicon.ico가 없어 실제로 404가 나고 있었다 — 브라우저 세션마다
// 매번은 아니고 내부 스케줄링에 따라 산발적으로 실패가 눈에 띄었을 뿐이다.
// 이 파일이 다시 사라지는 회귀를 빠르고 결정적으로 잡기 위한 테스트다.
test('브라우저가 자동으로 요청하는 /favicon.ico 가 200을 반환한다', async ({
  request,
}) => {
  const response = await request.get(`${e2eEnvironment.baseUrl}/favicon.ico`);

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/');
});
