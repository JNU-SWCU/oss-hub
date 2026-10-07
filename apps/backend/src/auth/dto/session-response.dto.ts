import { MeResponseDto } from './me-response.dto';

export class SessionResponseDto {
  readonly isAuthenticated: boolean;
  readonly user?: MeResponseDto;

  private constructor(isAuthenticated: boolean, user?: MeResponseDto) {
    this.isAuthenticated = isAuthenticated;
    if (user) {
      this.user = user;
    }
  }

  static anonymous(): SessionResponseDto {
    return new SessionResponseDto(false);
  }

  static authenticated(user: MeResponseDto): SessionResponseDto {
    return new SessionResponseDto(true, user);
  }
}
