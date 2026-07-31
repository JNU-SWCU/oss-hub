// architecture-boundary.eslint.spec.ts 전용 헬퍼.
//
// Jest는 CJS/vm 샌드박스에서 테스트를 실행하기 때문에, 그 안에서 ESLint가
// flat config(eslint.config.mjs)를 로드하려고 내부적으로 호출하는 동적
// import()가 "--experimental-vm-modules 없이 호출됐다"는 에러로 즉시
// 실패한다. 전체 backend의 test:unit 실행 방식(NODE_OPTIONS)을 바꾸는 대신,
// 이 스크립트를 평범한 Node 자식 프로세스로 띄워 실제 eslint.config.mjs를
// 정상적으로 로드하고, 결과 메시지만 JSON으로 부모(Jest)에 돌려준다.
import { ESLint } from 'eslint';

const [, , cwd, targetFile] = process.argv;

if (!cwd || !targetFile) {
  console.error('usage: node lint-fixture-runner.mjs <cwd> <targetFile>');
  process.exit(2);
}

const eslint = new ESLint({ cwd });
const [result] = await eslint.lintFiles([targetFile]);

process.stdout.write(JSON.stringify(result?.messages ?? []));
