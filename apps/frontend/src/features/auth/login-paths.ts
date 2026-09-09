import { apiPath } from '@/lib/api-client';

export const githubLoginPath = apiPath('auth/github');
export const githubAccountChoicePath = apiPath(
  'auth/github?prompt=select_account',
);
