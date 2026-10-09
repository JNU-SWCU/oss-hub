import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureHttpApp } from '../../src/common/configure-http-app';
import { GithubAppClient } from '../../src/github/github-app.client';
import { GithubOperationsConfig } from '../../src/github/github-operations.config';
import { MAIL_SENDER } from '../../src/notifications/mail-sender.port';
import { ProgramAuthoringRepository } from '../../src/programs/program-authoring.repository';
import { OBJECT_STORAGE } from '../../src/storage/domain/object-storage';
import type { RuntimeConfig } from '../../src/runtime-config/runtime-config';
import { RUNTIME_CONFIG } from '../../src/runtime-config/runtime-config.module';
import { E2eProgramAuthoringModule } from './e2e-program-authoring.module';
import { FaultInjectingProgramAuthoringRepository } from './fault-injecting-program-authoring.repository';
import { e2eProgramAuthoringExternalPorts } from './e2e-external-ports';

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      'E2E program authoring entry point requires NODE_ENV=test.',
    );
  }

  const ports = e2eProgramAuthoringExternalPorts;
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, E2eProgramAuthoringModule],
  })
    .overrideProvider(OBJECT_STORAGE)
    .useValue(ports.storage)
    .overrideProvider(MAIL_SENDER)
    .useValue(ports.mail)
    .overrideProvider(GithubAppClient)
    .useValue(ports.github)
    .overrideProvider(ProgramAuthoringRepository)
    .useClass(FaultInjectingProgramAuthoringRepository)
    .compile();

  const app = moduleRef.createNestApplication();
  configureHttpApp(app);
  ports.github.configureOrganization(
    app.get(GithubOperationsConfig).requireOrganization(),
  );

  const runtimeConfig = app.get<RuntimeConfig>(RUNTIME_CONFIG);
  const port = Number.parseInt(runtimeConfig.PORT ?? '4000', 10);
  const listenPort = Number.isNaN(port) ? 4000 : port;
  await app.listen(listenPort, '127.0.0.1');
}

void bootstrap();
