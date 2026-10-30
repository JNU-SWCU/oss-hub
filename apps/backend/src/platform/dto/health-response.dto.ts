export class HealthResponseDto {
  declare readonly status: 'ok';

  static from(): HealthResponseDto {
    return { status: 'ok' };
  }
}
