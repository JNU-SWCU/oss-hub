import type { MyRepositories } from './types';

class MyRepositoriesLoadError extends Error {
  constructor() {
    super('내 저장소를 불러오지 못했습니다');
    this.name = 'MyRepositoriesLoadError';
  }
}

export async function loadMyRepositories(): Promise<MyRepositories> {
  throw new MyRepositoriesLoadError();
}
