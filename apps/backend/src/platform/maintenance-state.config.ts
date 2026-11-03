import { get } from 'node:http';
import {
  MaintenanceConfig,
  MaintenanceVerificationError,
} from '../github/maintenance.config';
import { PROCESS_RUNTIME_CONFIG } from './runtime-config-instance.config';

export const MAINTENANCE_STATE_PATH = '/internal/maintenance-state';

export class MaintenanceStateConfig {
  static async verify(this: void, args: readonly string[]): Promise<void> {
    MaintenanceConfig.requireMaintenance();
    if (args.length !== 0) {
      throw new MaintenanceVerificationError('no arguments are allowed');
    }
    const configuredPort = Number.parseInt(
      PROCESS_RUNTIME_CONFIG.PORT ?? '4000',
      10,
    );
    const port = Number.isNaN(configuredPort) ? 4000 : configuredPort;
    const state = await new Promise<unknown>((resolve, reject) => {
      const request = get(
        `http://127.0.0.1:${port}${MAINTENANCE_STATE_PATH}`,
        { signal: AbortSignal.timeout(10_000) },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(
              new MaintenanceVerificationError('running process is not ready'),
            );
            return;
          }
          response.setEncoding('utf8');
          let body = '';
          response.on('data', (chunk: string) => {
            body += chunk;
            if (body.length > 16_384) {
              response.destroy(
                new MaintenanceVerificationError('state response is too large'),
              );
            }
          });
          response.on('error', reject);
          response.on('end', () => {
            try {
              const parsed: unknown = JSON.parse(body);
              resolve(parsed);
            } catch (error) {
              reject(
                error instanceof Error
                  ? error
                  : new MaintenanceVerificationError('invalid JSON'),
              );
            }
          });
        },
      );
      request.on('error', reject);
    });
    if (
      typeof state !== 'object' ||
      state === null ||
      !('maintenance' in state) ||
      state.maintenance !== true ||
      !('ready' in state) ||
      state.ready !== true ||
      !('pid' in state) ||
      typeof state.pid !== 'number' ||
      state.pid === process.pid ||
      !Number.isSafeInteger(state.pid) ||
      state.pid <= 0 ||
      !('schedules' in state) ||
      typeof state.schedules !== 'object' ||
      state.schedules === null ||
      !('cronJobs' in state.schedules) ||
      state.schedules.cronJobs !== 0 ||
      !('intervals' in state.schedules) ||
      state.schedules.intervals !== 0 ||
      !('timeouts' in state.schedules) ||
      state.schedules.timeouts !== 0
    ) {
      throw new MaintenanceVerificationError('invalid running process state');
    }
    process.stdout.write(
      `${JSON.stringify({ event: 'maintenance.state.verified', ...state })}\n`,
    );
  }
}

export const MAINTENANCE_STATE_COMMANDS = new Map([
  [
    'verify-maintenance-state',
    {
      maintenanceSafe: true as const,
      run: MaintenanceStateConfig.verify,
      failureMessage: () => 'Maintenance running-state verification failed.',
    },
  ],
]);
