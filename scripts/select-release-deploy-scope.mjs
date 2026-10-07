#!/usr/bin/env node

import { selectReleaseDeployScope } from './select-release-deploy-scope-lib.mjs';

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
    });
    process.stdin.on('end', () => resolve(buffer));
    process.stdin.on('error', reject);
  });
}

const input = await readStdin();
const scope = selectReleaseDeployScope(input.split('\n'));

process.stdout.write(`frontend=${scope.frontend}\n`);
process.stdout.write(`backend=${scope.backend}\n`);
