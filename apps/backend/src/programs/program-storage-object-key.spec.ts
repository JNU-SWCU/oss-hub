import { SubmissionFileAdmissionService } from './submission-file-admission.service';
import { ProgramAuthoringUploadService } from './program-authoring-upload.service';
import { ProgramNoticeFetchClient } from './program-notice-fetch.client';
import { randomUUID } from 'node:crypto';

const programAuthoringUploadService = new ProgramAuthoringUploadService(
  {} as never,
  {} as never,
  new SubmissionFileAdmissionService(),
  new ProgramNoticeFetchClient(),
);

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('program storage object keys', () => {
  it('preserves the authoring and cover namespaces with opaque UUID suffixes', () => {
    jest
      .mocked(randomUUID)
      .mockReturnValueOnce('3b7985fb-59fc-4330-8299-ea8dadb975d1')
      .mockReturnValueOnce('0d52cb2d-fd90-4ae9-b7ca-0b5bc42f234a');

    expect(
      programAuthoringUploadService.createProgramAuthoringObjectKey(),
    ).toBe('program-authoring/3b7985fb-59fc-4330-8299-ea8dadb975d1');
    expect(programAuthoringUploadService.createProgramCoverObjectKey()).toBe(
      'program-covers/0d52cb2d-fd90-4ae9-b7ca-0b5bc42f234a',
    );
  });
});
