import { test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';
import { runValidationAndFailures } from './support/legacy-member-reclassification-failure-scenario';
import { runForcedUiAbsenceMatrix } from './support/legacy-member-reclassification-matrix-scenario';
import {
  finalizeLegacyReclassificationSuite,
  resetLegacyReclassificationSuite,
} from './support/legacy-member-reclassification-suite';
import {
  runStaffSuccess,
  runStudentSuccessAndReplay,
} from './support/legacy-member-reclassification-success-scenarios';

test.describe.configure({ mode: 'serial' });

test.beforeAll(resetLegacyReclassificationSuite);
test.afterAll(finalizeLegacyReclassificationSuite);

test('STUDENT success and same-payload replay use exact pre-armed signals', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await runStudentSuccessAndReplay(page, testInfo);
});

test('STAFF success captures PROGRAM_OFFICE and omits student ID', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await runStaffSuccess(page, testInfo);
});

test('validation, pending, generic error, and 409 conflict retain deterministic focus and state', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  await runValidationAndFailures(page, testInfo);
});

test('forced UI is absent for every non-eligible session state', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  await runForcedUiAbsenceMatrix(browser, e2eEnvironment.baseUrl);
});
