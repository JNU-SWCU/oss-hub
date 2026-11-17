import { loadPrismaQueryLintConfig } from '../src/platform/prisma-query-lint.config';

const problems = loadPrismaQueryLintConfig({
  nodeEnv: 'development',
}).auditAllowlist();
if (problems.length > 0) {
  console.error(problems.join('\n'));
  process.exit(1);
}
