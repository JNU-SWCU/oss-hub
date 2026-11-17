import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter((arg) => arg !== '--');
const outIndex = args.indexOf('--out');
const outputArg = outIndex === -1 ? args[0] : args[outIndex + 1];
const outputPath = resolve(
  outputArg ?? resolve(backendRoot, '../../verify/openapi.baseline.json'),
);
const requireFromBackend = createRequire(resolve(backendRoot, 'package.json'));
const { NestFactory } = requireFromBackend('@nestjs/core');
const { DocumentBuilder, SwaggerModule } =
  requireFromBackend('@nestjs/swagger');
const { AppModule } = requireFromBackend('./dist/src/app.module');

const app = await NestFactory.create(AppModule, {
  preview: true,
  abortOnError: false,
  logger: false,
});
app.setGlobalPrefix('api/v1');
const document = SwaggerModule.createDocument(
  app,
  new DocumentBuilder().setTitle('JNU OSS Hub API').setVersion('1').build(),
);
await app.close();
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`);
console.log(
  `openapi: ${Object.keys(document.paths).length} paths -> ${outputPath}`,
);
