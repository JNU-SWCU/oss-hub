import { apiClient } from '@/lib/api-client';
import { parseMyRepositoriesResponse } from './parser';
import type { MyRepositories } from './types';

class MyRepositoriesLoadError extends Error {
  constructor() {
    super('내 저장소를 불러오지 못했습니다');
    this.name = 'MyRepositoriesLoadError';
  }
}

export async function loadMyRepositories(): Promise<MyRepositories> {
  try {
    return parseMyRepositoriesResponse(
      await apiClient<unknown>('repositories/me'),
    );
  } catch {
    throw new MyRepositoriesLoadError();
  }
}
