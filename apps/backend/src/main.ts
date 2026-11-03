import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthConfig } from './platform/auth.config';
import { configureHttpApp } from './configure-http-app';
import type { RuntimeConfig } from './platform/runtime-config.config';
import { RUNTIME_CONFIG } from './platform/runtime-config-instance.config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { RequestHandler } from 'express';
import { HealthService } from './platform/health.service';
import { MaintenanceConfig } from './github/maintenance.config';
import { MAINTENANCE_STATE_PATH } from './platform/maintenance-state.config';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.get(AuthConfig).validate();
  configureHttpApp(app);

  const runtimeConfig = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  const port = Number.parseInt(runtimeConfig.PORT ?? '4000', 10);
  const listenPort = Number.isNaN(port) ? 4000 : port;
  if (MaintenanceConfig.enabled()) {
    const handler: RequestHandler = async (request, response, next) => {
      const address = request.socket.remoteAddress;
      if (
        request.method !== 'GET' ||
        request.headers.host !== `127.0.0.1:${listenPort}` ||
        Object.keys(request.headers).some(
          (name) =>
            name === 'forwarded' ||
            name.startsWith('x-forwarded-') ||
            name === 'x-real-ip' ||
            name === 'x-vercel-forwarded-for',
        ) ||
        (address !== '127.0.0.1' &&
          address !== '::1' &&
          address !== '::ffff:127.0.0.1')
      ) {
        response.sendStatus(404);
        return;
      }
      try {
        const schedules = MaintenanceConfig.scheduleState(
          app.get(SchedulerRegistry),
        );
        await app.get(HealthService).assertDatabaseReachable();
        response.json({
          maintenance: true,
          ready: true,
          pid: process.pid,
          schedules,
        });
      } catch (error) {
        next(error);
      }
    };
    app.use(MAINTENANCE_STATE_PATH, handler);
  }
  await app.listen(listenPort);
}

if (require.main === module) {
  void bootstrap();
}
