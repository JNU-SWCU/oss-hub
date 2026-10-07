import { ESLint } from 'eslint';

const [, , cwd, targetFile] = process.argv;

if (!cwd || !targetFile) {
  console.error('usage: node lint-fixture-runner.mjs <cwd> <targetFile>');
  process.exit(2);
}

const eslint = new ESLint({ cwd });
const [result] = await eslint.lintFiles([targetFile]);

process.stdout.write(JSON.stringify(result?.messages ?? []));
