export class ProvisioningRetryResponseDto {
  declare readonly teamId: string;
  declare readonly requestId: string;
  declare readonly status: 'PENDING';

  static from(
    teamId: string,
    result: { readonly eventId: string },
  ): ProvisioningRetryResponseDto {
    return { teamId, requestId: result.eventId, status: 'PENDING' };
  }
}
