export const E2E_PROGRAM_AUTHORING_FLAG = 'E2E_PROGRAM_AUTHORING_CONTROL';

export function e2eProgramAuthoringControlEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const enabled = env[E2E_PROGRAM_AUTHORING_FLAG] === 'enabled';
  if (env.NODE_ENV === 'production' && enabled) {
    throw new Error(
      'E2E program authoring control is forbidden in production.',
    );
  }
  return env.NODE_ENV === 'test' && enabled;
}
