import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemDetailFilter } from './common/problem-detail.filter';
import type { RuntimeConfig } from './runtime-config/runtime-config';
import { RUNTIME_CONFIG } from './runtime-config/runtime-config.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailFilter());

  const runtimeConfig = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  const port = Number.parseInt(runtimeConfig.PORT ?? '4000', 10);
  await app.listen(Number.isNaN(port) ? 4000 : port);
}

void bootstrap();
