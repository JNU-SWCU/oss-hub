export class LogoutResponseDto {
  declare readonly isAuthenticated: boolean;

  static from(isAuthenticated: boolean): LogoutResponseDto {
    return { isAuthenticated };
  }
}
