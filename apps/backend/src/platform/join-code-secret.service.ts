import { loadRuntimeConfig, type RuntimeConfig } from './runtime-config.config';
import { PROCESS_RUNTIME_CONFIG } from './runtime-config-instance.config';
import { createHmac } from 'node:crypto';
import { JoinCodeSecretError } from './join-code-secret.config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class JoinCodeSecretService {
  computeJoinCodeDigest(joinCode: string, secret: string): string {
    return createHmac('sha256', secret).update(joinCode).digest('hex');
  }

  resolveJoinCodeSecretFromConfig(
    config: Pick<RuntimeConfig, 'TEAM_JOIN_CODE_SECRET'>,
  ): string {
    const secret = config.TEAM_JOIN_CODE_SECRET;

    if (secret !== undefined && secret.trim() !== '') {
      return secret;
    }
    throw new JoinCodeSecretError();
  }

  resolveJoinCodeSecret(env?: NodeJS.ProcessEnv): string {
    const config = env ? loadRuntimeConfig(env) : PROCESS_RUNTIME_CONFIG;
    return this.resolveJoinCodeSecretFromConfig(config);
  }
}
