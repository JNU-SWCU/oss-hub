import { accessSync, constants, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

class StateAccessError extends Error {}

try {
  const [root, isolated] = process.argv.slice(2);
  const uid = process.getuid();
  const rehearsal =
    isolated === '1' && root !== '/var/lib/oss-hub/user-consolidation';
  if (!isAbsolute(root) || (!rehearsal && uid !== 0))
    throw new StateAccessError();
  let current = root;
  for (;;) {
    try {
      const stat = lstatSync(current);
      if (
        !stat.isDirectory() ||
        stat.uid !== (rehearsal ? uid : 0) ||
        (current === root
          ? (stat.mode & 0o777) !== 0o700
          : (stat.mode & 0o022) !== 0)
      )
        throw new StateAccessError();
      accessSync(current, constants.R_OK | constants.X_OK);
      process.stdout.write(
        resolve(realpathSync(current), relative(current, root)),
      );
      break;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (error.code !== 'ENOENT' || current === dirname(current)) throw error;
      current = dirname(current);
    }
  }
} catch (error) {
  if (!(error instanceof Error)) throw error;
  process.stderr.write('FAIL_CLOSED state-access\n');
  process.exitCode = 1;
}
