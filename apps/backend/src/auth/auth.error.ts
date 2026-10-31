export class StaffAccessRequestSeedConflictError extends Error {
  constructor() {
    super('초기 역할 시드가 전이하려던 신청이 이미 결정되었습니다.');
    this.name = 'StaffAccessRequestSeedConflictError';
  }
}
