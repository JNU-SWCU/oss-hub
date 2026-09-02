#!/usr/bin/env node
// stdin 으로 받은 변경 경로 목록을 릴리스 배포 대상 판정으로 바꾼다.
// 출력은 `frontend=<bool>` `backend=<bool>` 두 줄이며 GITHUB_OUTPUT 에 그대로 덧붙일 수 있다.
//
//   git diff --name-only "$PREV_TAG" "$TAG" | node scripts/select-release-deploy-scope.mjs

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
