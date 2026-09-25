import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, 'e2e-program-authoring-actors.ts'),
  'utf8',
);

describe('E2E program-authoring actors', () => {
  it('creates and refreshes active opted-in synthetic student and staff recipients', () => {
    expect(source).toContain(
      "notificationEmail: 'e2e-program-authoring-staff@fixture.invalid'",
    );
    expect(source).toContain(
      "notificationEmail: 'e2e-program-authoring-student@fixture.invalid'",
    );
    expect(source).toMatch(
      /notificationEmail:\s+'e2e-program-authoring-foreign-student@fixture\.invalid'/u,
    );
    expect(source.match(/notifyEnabled: true/g)).toHaveLength(6);
    expect(source.match(/accountStatus: AccountStatus.ACTIVE/g)).toHaveLength(
      6,
    );
  });
});
