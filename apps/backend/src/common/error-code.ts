export interface ErrorCode {
  code: string;
  status: number;
  message: string;
}

export class DomainException extends Error {
  constructor(public readonly errorCode: ErrorCode) {
    super(errorCode.message);
    this.name = 'DomainException';
  }
}
