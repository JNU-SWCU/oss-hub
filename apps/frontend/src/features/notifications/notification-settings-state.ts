const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 수신 이메일 형식 검증 — 백엔드 class-validator @IsEmail과 같은 계약을 화면에서 선검증한다. */
export function isValidNotificationEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}
