import { randomUUID } from 'node:crypto';
import { createProgramAuthoringObjectKey } from './program-authoring-object-key';
import { createProgramCoverObjectKey } from './program-cover-object-key';

jest.mock('node:crypto', () => ({
  randomUUID: jest.fn(),
}));

describe('program storage object keys', () => {
  it('preserves the authoring and cover namespaces with opaque UUID suffixes', () => {
    jest
      .mocked(randomUUID)
      .mockReturnValueOnce('3b7985fb-59fc-4330-8299-ea8dadb975d1')
      .mockReturnValueOnce('0d52cb2d-fd90-4ae9-b7ca-0b5bc42f234a');

    expect(createProgramAuthoringObjectKey()).toBe(
      'program-authoring/3b7985fb-59fc-4330-8299-ea8dadb975d1',
    );
    expect(createProgramCoverObjectKey()).toBe(
      'program-covers/0d52cb2d-fd90-4ae9-b7ca-0b5bc42f234a',
    );
  });
});
