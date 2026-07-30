import { createHmac } from 'node:crypto';
import {
  loadRuntimeConfig,
  type RuntimeConfig,
} from '../runtime-config/runtime-config';
import { PROCESS_RUNTIME_CONFIG } from '../runtime-config/runtime-config.instance';

export class JoinCodeSecretError extends Error {
  readonly envName = 'TEAM_JOIN_CODE_SECRET';

  constructor() {
    super('TEAM_JOIN_CODE_SECRET이 필수입니다.');
    this.name = JoinCodeSecretError.name;
  }
}

export function resolveJoinCodeSecretFromConfig(
  config: Pick<RuntimeConfig, 'TEAM_JOIN_CODE_SECRET'>,
): string {
  const secret = config.TEAM_JOIN_CODE_SECRET;
  // Blank/whitespace-only values are rejected in every environment.
  // Nonblank secrets are returned exactly so HMAC digests stay stable.
  if (secret !== undefined && secret.trim() !== '') {
    return secret;
  }
  throw new JoinCodeSecretError();
}

export function resolveJoinCodeSecret(env?: NodeJS.ProcessEnv): string {
  const config = env ? loadRuntimeConfig(env) : PROCESS_RUNTIME_CONFIG;
  return resolveJoinCodeSecretFromConfig(config);
}

export function computeJoinCodeDigest(
  joinCode: string,
  secret: string = resolveJoinCodeSecret(),
): string {
  return createHmac('sha256', secret).update(joinCode).digest('hex');
}
