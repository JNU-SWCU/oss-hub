export class LogoutResponseDto {
  isAuthenticated: boolean;

  constructor(isAuthenticated: boolean) {
    this.isAuthenticated = isAuthenticated;
  }
}
