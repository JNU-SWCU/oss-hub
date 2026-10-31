import { runCli } from './cli';

describe('backend CLI dispatch', () => {
  const originalExitCode = process.exitCode;

  afterEach(() => {
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
  });

  it.each([[[]], [['--help']], [['unknown-command']], [['constructor']]])(
    'prints usage and exits non-zero for %j',
    async (argv) => {
      const stderr = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation(() => true);

      await runCli(argv);

      expect(process.exitCode).toBe(1);
      expect(String(stderr.mock.calls[0]?.[0])).toContain(
        'retry-submission-file-cleanup, reconcile-storage-orphans, send-deadline-digest',
      );
    },
  );
});
