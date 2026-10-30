import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ProblemDetailFilter } from './problem-detail.filter';

export function configureHttpApp(app: INestApplication): void {
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
