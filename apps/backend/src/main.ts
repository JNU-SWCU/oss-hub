import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttpApp } from './common/configure-http-app';
import type { RuntimeConfig } from './runtime-config/runtime-config';
import { RUNTIME_CONFIG } from './runtime-config/runtime-config.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureHttpApp(app);

  const runtimeConfig = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  const port = Number.parseInt(runtimeConfig.PORT ?? '4000', 10);
  const listenPort = Number.isNaN(port) ? 4000 : port;
  await app.listen(listenPort);
}

void bootstrap();
