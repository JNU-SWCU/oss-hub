import { expect, test } from '@playwright/test';

import { e2eEnvironment } from './environment';

test('브라우저가 자동으로 요청하는 /favicon.ico 가 200을 반환한다', async ({
  request,
}) => {
  const response = await request.get(`${e2eEnvironment.baseUrl}/favicon.ico`);

  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('image/');
});
