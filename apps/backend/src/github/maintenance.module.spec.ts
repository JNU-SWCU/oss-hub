describe('maintenance capability command', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    process.exitCode = 0;
  });

  it('checks production scheduler wiring and a real empty registry without connecting Prisma', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      OSS_HUB_MAINTENANCE: '1',
    });
    const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    await jest.isolateModulesAsync(async () => {
      const { PrismaService } = await import('../platform/prisma.service');
      const connect = jest.spyOn(PrismaService.prototype, 'onModuleInit');
      const { MaintenanceModule } = await import('./maintenance.module');

      await MaintenanceModule.verify([]);

      expect(connect).not.toHaveBeenCalled();
      const result: unknown = JSON.parse(String(output.mock.calls[0]?.[0]));
      expect(result).toEqual({
        event: 'maintenance.capability.verified',
        schedules: { cronJobs: 0, intervals: 0, timeouts: 0 },
      });
    });
  });

  it('fails closed without the maintenance environment', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      OSS_HUB_MAINTENANCE: '',
    });
    await jest.isolateModulesAsync(async () => {
      const { MaintenanceModule } = await import('./maintenance.module');
      await expect(MaintenanceModule.verify([])).rejects.toThrow(
        'OSS_HUB_MAINTENANCE=1 is required',
      );
    });
  });

  it('blocks forced mail CLI execution before its external side effect', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      OSS_HUB_MAINTENANCE: '1',
      DIGEST_FORCE_TO: 'maintenance@example.test',
    });
    jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    await jest.isolateModulesAsync(async () => {
      const { DeadlineDigestMailService } =
        await import('../notifications/deadline-digest-mail.service');
      const send = jest
        .spyOn(DeadlineDigestMailService.prototype, 'sendForcedDeadlineDigest')
        .mockResolvedValue(undefined);
      const { runCli } = await import('../cli');

      await runCli(['send-deadline-digest']);

      expect(process.exitCode).toBe(1);
      expect(send).not.toHaveBeenCalled();
    });
  });
});
