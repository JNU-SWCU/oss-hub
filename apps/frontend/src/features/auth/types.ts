export interface Me {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface LogoutResult {
  isAuthenticated: boolean;
}
