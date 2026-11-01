import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AuthConfig } from './platform/auth.config';
import { configureHttpApp } from './configure-http-app';
import type { RuntimeConfig } from './platform/runtime-config.config';
import { RUNTIME_CONFIG } from './platform/runtime-config-instance.config';

export async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.get(AuthConfig).validate();
  configureHttpApp(app);

  const runtimeConfig = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  const port = Number.parseInt(runtimeConfig.PORT ?? '4000', 10);
  const listenPort = Number.isNaN(port) ? 4000 : port;
  await app.listen(listenPort);
}

if (require.main === module) {
  void bootstrap();
}
