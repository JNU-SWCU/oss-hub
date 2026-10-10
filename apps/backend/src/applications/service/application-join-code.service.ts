import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { computeJoinCodeDigest } from '../../programs/domain/join-code-digest';
import { resolveJoinCodeSecretFromConfig } from '../../runtime-config/join-code-secret';
import type { RuntimeConfig } from '../../runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../../runtime-config/runtime-config.module';

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
