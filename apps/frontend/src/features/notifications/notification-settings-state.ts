const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidNotificationEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}
