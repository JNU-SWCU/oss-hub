/** api-client가 모든 2xx에서 JSON을 읽으므로 204 대신 200 + 본문을 반환한다. */
export class LogoutResponseDto {
  isAuthenticated: boolean;

  constructor(isAuthenticated: boolean) {
    this.isAuthenticated = isAuthenticated;
  }
}
