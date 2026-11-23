export class AcceptedMailResponseDto {
  declare readonly jobId: string;
  declare readonly status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED';
  static from(job: AcceptedMailResponseDto): AcceptedMailResponseDto {
    return { jobId: job.jobId, status: job.status };
  }
}
