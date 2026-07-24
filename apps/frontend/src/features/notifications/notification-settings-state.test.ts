import { expect, test } from 'vitest';
import { isValidNotificationEmail } from './notification-settings-state';

test('올바른 이메일 형식을 통과시킨다', () => {
  expect(isValidNotificationEmail('staff@jnu.ac.kr')).toBe(true);
  expect(isValidNotificationEmail('  a.b@example.com  ')).toBe(true);
});

test('잘못된 이메일 형식을 거부한다', () => {
  expect(isValidNotificationEmail('')).toBe(false);
  expect(isValidNotificationEmail('staff')).toBe(false);
  expect(isValidNotificationEmail('staff@')).toBe(false);
  expect(isValidNotificationEmail('staff@jnu')).toBe(false);
  expect(isValidNotificationEmail('a b@c.com')).toBe(false);
});
