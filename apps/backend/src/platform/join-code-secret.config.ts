export class JoinCodeSecretError extends Error {
  readonly envName = 'TEAM_JOIN_CODE_SECRET';

  constructor() {
    super('TEAM_JOIN_CODE_SECRET이 필수입니다.');
    this.name = JoinCodeSecretError.name;
  }
}
