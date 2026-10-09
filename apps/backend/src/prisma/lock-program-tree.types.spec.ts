import * as path from 'node:path';
import * as ts from 'typescript';

describe('program tree witness types', () => {
  it.each([
    "lockProgramTree(tx, { stage: 'documents', after: p, documentKind: 'ALL' });",
    "lockProgramTree(tx, { stage: 'documents', documentKind: 'ALL' });",
    "lockProgramTree(tx, { stage: 'milestone', milestoneId: 'm', after: m });",
    "const forged: MilestoneLock = { id: 'm', programId: 'p' };",
  ])('rejects invalid witness construction or transitions: %s', (statement) => {
    const file = path.resolve(__dirname, 'witness-contract.ts');
    const source = `import { Prisma } from '@prisma/client';
      import { lockProgramTree, ProgramLock, MilestoneLock } from './lock-program-tree';
      declare const tx: Prisma.TransactionClient;
      declare const p: ProgramLock;
      declare const m: MilestoneLock;
      ${statement}`;
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    };
    const host = ts.createCompilerHost(options);
    const original = host.getSourceFile.bind(host);
    host.getSourceFile = (
      name,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    ) =>
      name === file
        ? ts.createSourceFile(file, source, languageVersion)
        : original(name, languageVersion, onError, shouldCreateNewSourceFile);
    const program = ts.createProgram([file], options, host);
    const diagnostics = program
      .getSemanticDiagnostics()
      .filter((diagnostic) => diagnostic.file?.fileName === file);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).not.toBe(2307);
  });
});
