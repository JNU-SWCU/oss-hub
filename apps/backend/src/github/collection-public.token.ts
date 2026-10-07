import type { RuntimeConfig } from '../runtime-config/runtime-config';
import { CollectionPublicReadConfig } from './collection-app.config';

export class CollectionPublicTokenProvider {
  private token: string | undefined;

  constructor(private readonly runtimeConfig: RuntimeConfig) {}

  getToken(): Promise<string> {
    if (this.token !== undefined) return Promise.resolve(this.token);
    try {
      const config = CollectionPublicReadConfig.fromRuntimeConfig(
        this.runtimeConfig,
      );
      this.token = config.token;
      return Promise.resolve(this.token);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  clear(): void {}
}
