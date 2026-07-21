import { Injectable } from '@nestjs/common';

function optionalEnvironmentValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

@Injectable()
export class GithubWebhookConfig {
  readonly targetOrg = optionalEnvironmentValue('GITHUB_APP_ORG');
  readonly webhookSecret = optionalEnvironmentValue(
    'GITHUB_COLLECTION_APP_WEBHOOK_SECRET',
  );
}
