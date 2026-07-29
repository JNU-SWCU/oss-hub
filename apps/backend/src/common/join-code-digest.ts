import { createHmac } from 'node:crypto';
import { loadRuntimeConfig } from '../runtime-config/runtime-config';
import { PROCESS_RUNTIME_CONFIG } from '../runtime-config/runtime-config.instance';

const DEV_DEFAULT_JOIN_CODE_SECRET = 'synthetic-oss-hub-join-code-secret';

export class JoinCodeSecretError extends Error {
  readonly envName = 'TEAM_JOIN_CODE_SECRET';

  constructor() {
    super('운영 환경에는 TEAM_JOIN_CODE_SECRET이 필수입니다.');
    this.name = JoinCodeSecretError.name;
  }
}

export function resolveJoinCodeSecret(env?: NodeJS.ProcessEnv): string {
  const config = env ? loadRuntimeConfig(env) : PROCESS_RUNTIME_CONFIG;
  const secret = config.TEAM_JOIN_CODE_SECRET;
  if (secret) {
    return secret;
  }
  if (config.NODE_ENV === 'production') {
    throw new JoinCodeSecretError();
  }
  return DEV_DEFAULT_JOIN_CODE_SECRET;
}

export function computeJoinCodeDigest(
  joinCode: string,
  secret: string = resolveJoinCodeSecret(),
): string {
  return createHmac('sha256', secret).update(joinCode).digest('hex');
}
