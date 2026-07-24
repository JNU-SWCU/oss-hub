export interface ErrorCode {
  code: string;
  status: number;
  message: string;
  readonly exposeToClient?: true;
}

export interface ProblemDetailFieldError {
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetailExtensions {
  readonly retryNotBeforeAt?: string;
  readonly fieldErrors?: readonly ProblemDetailFieldError[];
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
