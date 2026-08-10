import { Logger } from '@nestjs/common';
import type { ProgramAuthoringUploadMaintenanceService } from './program-authoring-upload-maintenance.service';
import { ProgramAuthoringUploadMaintenanceScheduler } from './program-authoring-upload-maintenance.scheduler';

function deferred(): {
  readonly promise: Promise<number>;
  readonly resolve: (value: number) => void;
} {
  let resolvePromise: ((value: number) => void) | undefined;
  const promise = new Promise<number>((resolve) => {
    resolvePromise = resolve;
  });
  if (resolvePromise === undefined) {
    throw new Error('Deferred promise was not initialized');
  }
  return { promise, resolve: resolvePromise };
}

describe('ProgramAuthoringUploadMaintenanceScheduler', () => {
  it('skips an overlapping hourly run', async () => {
    // Given
    const pending = deferred();
    const maintenance: jest.Mocked<
      Pick<ProgramAuthoringUploadMaintenanceService, 'runDue'>
    > = { runDue: jest.fn().mockReturnValue(pending.promise) };
    const scheduler = new ProgramAuthoringUploadMaintenanceScheduler(
      maintenance,
    );

    // When
    const first = scheduler.run();
    await scheduler.run();
    pending.resolve(1);
    await first;

    // Then
    expect(maintenance.runDue).toHaveBeenCalledTimes(1);
  });

  it('logs only a fixed safe code when a run fails', async () => {
    // Given
    const maintenance: jest.Mocked<
      Pick<ProgramAuthoringUploadMaintenanceService, 'runDue'>
    > = {
      runDue: jest
        .fn()
        .mockRejectedValue(new Error('database provider connection detail')),
    };
    const alert = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const scheduler = new ProgramAuthoringUploadMaintenanceScheduler(
      maintenance,
    );

    // When
    await scheduler.run();

    // Then
    expect(alert).toHaveBeenCalledWith({
      event: 'program-authoring-upload.cleanup.run.failed',
      errorCode: 'MAINTENANCE_RUN_FAILED',
    });
    expect(JSON.stringify(alert.mock.calls)).not.toContain('provider');
    alert.mockRestore();
  });
});
