export interface ErrorCode {
  code: string;
  status: number;
  message: string;
  readonly exposeToClient?: true;
}

export interface ProblemDetailExtensions {
  retryNotBeforeAt?: string;
}

export class DomainException extends Error {
  constructor(
    public readonly errorCode: ErrorCode,
    public readonly extensions: ProblemDetailExtensions = {},
  ) {
    super(errorCode.message);
    this.name = 'DomainException';
  }
}
