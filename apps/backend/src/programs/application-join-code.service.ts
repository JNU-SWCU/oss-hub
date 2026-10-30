import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { computeJoinCodeDigest } from './join-code-digest.policy';
import { resolveJoinCodeSecretFromConfig } from '../platform/join-code-secret.config';
import type { RuntimeConfig } from '../platform/runtime-config.config';
import { RUNTIME_CONFIG } from '../platform/runtime-config-instance.config';

@Injectable()
export class ApplicationJoinCodeService {
  private readonly joinCodeSecret: string;

  constructor(
    @Inject(RUNTIME_CONFIG)
    runtimeConfig: Pick<RuntimeConfig, 'TEAM_JOIN_CODE_SECRET'>,
  ) {
    this.joinCodeSecret = resolveJoinCodeSecretFromConfig(runtimeConfig);
  }

  generateJoinCode(): string {
    return randomBytes(6).toString('base64url').toUpperCase().slice(0, 10);
  }

  computeJoinCodeDigest(joinCode: string): string {
    return computeJoinCodeDigest(joinCode, this.joinCodeSecret);
  }
}
