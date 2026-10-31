import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { ProblemDetailFilter } from './platform/problem-detail.filter';

export function configureHttpApp(app: INestApplication): void {
  useContainer(app, { fallbackOnErrors: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ProblemDetailFilter());
}
