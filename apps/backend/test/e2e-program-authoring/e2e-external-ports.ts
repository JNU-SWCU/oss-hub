import { E2eFakeGithubAppClient } from './e2e-fake-github-app-client';
import { E2eFakeMailSender } from './e2e-fake-mail-sender';
import { E2eFakeSubmissionFileStorage } from './e2e-fake-submission-file-storage';
import {
  E2eExternalPortRegistry,
  type E2eExternalCapture,
} from './e2e-external-port-registry';

export {
  E2E_EXTERNAL_FAILURE_OPERATIONS,
  E2eExternalPortFailure,
} from './e2e-external-port-registry';

class E2eProgramAuthoringExternalPorts {
  readonly failures = new E2eExternalPortRegistry();
  readonly github = new E2eFakeGithubAppClient(this.failures);
  readonly mail = new E2eFakeMailSender(this.failures);
  readonly storage = new E2eFakeSubmissionFileStorage(this.failures);

  capture(): E2eExternalCapture {
    return this.failures.capture();
  }

  resetFailures(): void {
    this.failures.resetFailures();
  }

  reset(): void {
    this.failures.reset();
    this.github.reset();
    this.storage.reset();
  }
}

export const e2eProgramAuthoringExternalPorts =
  new E2eProgramAuthoringExternalPorts();
