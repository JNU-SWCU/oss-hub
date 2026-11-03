import { createServer, type Server } from 'node:http';

describe('maintenance running-state CLI', () => {
  let server: Server;
  let port: number;
  let body: string;
  let status: number;
  const readyState = {
    maintenance: true,
    ready: true,
    pid: process.pid + 1,
    schedules: { cronJobs: 0, intervals: 0, timeouts: 0 },
  };

  beforeEach(async () => {
    status = 200;
    body = JSON.stringify(readyState);
    server = createServer((_request, response) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(body);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('TCP listener is required');
    }
    port = address.port;
    jest.replaceProperty(process, 'env', {
      ...process.env,
      OSS_HUB_MAINTENANCE: '1',
      PORT: String(port),
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    jest.restoreAllMocks();
  });

  it('reads an already listening process rather than bootstrapping another app', async () => {
    const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    await jest.isolateModulesAsync(async () => {
      const { MaintenanceStateConfig } =
        await import('./maintenance-state.config');

      await MaintenanceStateConfig.verify([]);

      const result: unknown = JSON.parse(String(output.mock.calls[0]?.[0]));
      expect(result).toEqual({
        event: 'maintenance.state.verified',
        ...readyState,
      });
    });
  });

  it.each([
    { ...readyState, ready: false },
    { ...readyState, maintenance: false },
    { ...readyState, pid: process.pid },
    { ...readyState, schedules: { cronJobs: 1, intervals: 0, timeouts: 0 } },
    { ...readyState, schedules: { cronJobs: 0, intervals: 1, timeouts: 0 } },
    { ...readyState, schedules: { cronJobs: 0, intervals: 0, timeouts: 1 } },
  ])('rejects a non-maintenance or scheduled process: %j', async (state) => {
    body = JSON.stringify(state);
    await jest.isolateModulesAsync(async () => {
      const { MaintenanceStateConfig } =
        await import('./maintenance-state.config');

      await expect(MaintenanceStateConfig.verify([])).rejects.toThrow(
        'invalid running process state',
      );
    });
  });

  it('rejects HTTP readiness failure instead of trusting the environment flag', async () => {
    status = 503;
    await jest.isolateModulesAsync(async () => {
      const { MaintenanceStateConfig } =
        await import('./maintenance-state.config');

      await expect(MaintenanceStateConfig.verify([])).rejects.toThrow(
        'running process is not ready',
      );
    });
  });
});
