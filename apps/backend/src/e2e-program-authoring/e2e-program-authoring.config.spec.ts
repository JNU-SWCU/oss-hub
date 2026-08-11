import {
  e2eProgramAuthoringControlEnabled,
  E2E_PROGRAM_AUTHORING_FLAG,
} from './e2e-program-authoring.config';

describe('e2eProgramAuthoringControlEnabled', () => {
  it('registers only for explicit test control', () => {
    expect(e2eProgramAuthoringControlEnabled({ NODE_ENV: 'test' })).toBe(false);
    expect(
      e2eProgramAuthoringControlEnabled({
        NODE_ENV: 'test',
        [E2E_PROGRAM_AUTHORING_FLAG]: 'enabled',
      }),
    ).toBe(true);
  });

  it('fails closed when production enables the control plane', () => {
    expect(() =>
      e2eProgramAuthoringControlEnabled({
        NODE_ENV: 'production',
        [E2E_PROGRAM_AUTHORING_FLAG]: 'enabled',
      }),
    ).toThrow(/forbidden/);
  });
});
