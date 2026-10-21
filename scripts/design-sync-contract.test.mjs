import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
  readdirSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'apps/frontend/package.json'));
const ts = require('typescript');
for (const script of ['emit-types.mjs', 'compile-css.mjs']) {
  const result = spawnSync(
    process.execPath,
    [path.join(root, '.design-sync', script)],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}

function validatePreviews(files, entry) {
  const program = ts.createProgram([entry, ...files], {
    jsx: ts.JsxEmit.ReactJSX,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    module: ts.ModuleKind.ESNext,
    baseUrl: path.join(root, 'apps/frontend'),
    paths: {
      frontend: [entry],
      react: ['node_modules/@types/react'],
      'react/*': ['node_modules/@types/react/*'],
      '@/*': ['src/*'],
    },
    esModuleInterop: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  for (const file of files) {
    if (path.basename(file) === 'AppShell.tsx') {
      assert.deepEqual(
        program
          .getSemanticDiagnostics(program.getSourceFile(file))
          .map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
          ),
        [],
        'AppShell Card composition must satisfy its prop contracts',
      );
    }
    for (const statement of program.getSourceFile(file).statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        statement.moduleSpecifier.text !== 'frontend'
      )
        continue;
      const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier);
      assert.ok(symbol, 'frontend module must resolve');
      const names = new Set(
        checker.getExportsOfModule(symbol).map((item) => item.name),
      );
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const item of bindings.elements) {
          assert.ok(
            names.has((item.propertyName ?? item.name).text),
            `named export must exist: ${path.basename(file)} ${(item.propertyName ?? item.name).text}`,
          );
        }
      }
    }
  }
}

function validateConfig(config, packageRoot) {
  for (const key of ['srcDir', 'tsconfig', 'cssEntry']) {
    assert.ok(existsSync(path.resolve(packageRoot, config[key])), key);
  }
  assert.ok(
    existsSync(path.resolve(root, config.readmeHeader)),
    'readmeHeader',
  );
  for (const file of config.guidelinesGlob)
    assert.ok(existsSync(path.resolve(packageRoot, file)));
}

test('remaining previews resolve public frontend named exports', () => {
  const directory = path.join(root, '.design-sync/previews');
  validatePreviews(
    readdirSync(directory)
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => path.join(directory, name)),
    path.join(root, 'apps/frontend/index.d.ts'),
  );
});

test('preview resolution rejects missing named exports', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'design-preview-'));
  try {
    const preview = path.join(directory, 'preview.tsx');
    writeFileSync(preview, "import { MissingPublicExport } from 'frontend';");
    assert.throws(
      () =>
        validatePreviews(
          [preview],
          path.join(root, 'apps/frontend/index.d.ts'),
        ),
      /named export/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('converter input paths resolve and missing input fails', () => {
  const config = JSON.parse(
    readFileSync(path.join(root, '.design-sync/config.json'), 'utf8'),
  );
  const packageRoot = path.join(root, 'apps/frontend');
  validateConfig(config, packageRoot);
  const directory = mkdtempSync(path.join(tmpdir(), 'design-config-'));
  try {
    mkdirSync(path.join(directory, 'src'), { recursive: true });
    writeFileSync(path.join(directory, 'tsconfig.json'), '{}');
    writeFileSync(path.join(directory, 'style.css'), '');
    validateConfig(
      {
        ...config,
        srcDir: 'src',
        tsconfig: 'tsconfig.json',
        cssEntry: 'style.css',
      },
      directory,
    );
    assert.ok(existsSync(path.resolve(packageRoot, config.srcDir)));
    assert.ok(existsSync(path.resolve(packageRoot, config.tsconfig)));
    assert.throws(
      () => validateConfig({ ...config, srcDir: 'missing' }, directory),
      /srcDir/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const fail of [false, true]) {
  test(
    fail
      ? 'compiler failure preserves existing artifact and exits nonzero'
      : 'successful emission replaces stale declarations with fresh exports',
    () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'design-emission-'));
      try {
        const pkg = path.join(directory, 'apps/frontend');
        mkdirSync(path.join(directory, '.design-sync'), { recursive: true });
        mkdirSync(path.join(pkg, 'node_modules/.bin'), { recursive: true });
        mkdirSync(path.join(pkg, 'ds-types/components/ui'), {
          recursive: true,
        });
        writeFileSync(
          path.join(pkg, 'ds-types/components/ui/stale.d.ts'),
          'stale',
        );
        writeFileSync(path.join(pkg, 'index.d.ts'), 'previous');
        cpSync(
          path.join(root, '.design-sync/emit-types.mjs'),
          path.join(directory, '.design-sync/emit-types.mjs'),
        );
        const compiler = path.join(pkg, 'node_modules/.bin/tsc');
        writeFileSync(
          compiler,
          '#!/usr/bin/env node\n' +
            `const fs=require('node:fs');const path=require('node:path');const out=process.argv[process.argv.indexOf('--declarationDir')+1];fs.mkdirSync(path.join(out,'components/ui'),{recursive:true});fs.writeFileSync(path.join(out,'components/index.d.ts'),'export {};');fs.writeFileSync(path.join(out,'components/ui/fresh.d.ts'),'export {};');process.exit(${fail ? 2 : 0});`,
        );
        chmodSync(compiler, 0o755);
        const result = spawnSync(
          process.execPath,
          [path.join(directory, '.design-sync/emit-types.mjs')],
          { encoding: 'utf8' },
        );
        assert.equal(result.status, fail ? 1 : 0, result.stderr);
        const output = readFileSync(path.join(pkg, 'index.d.ts'), 'utf8');
        if (fail) {
          assert.equal(output, 'previous');
          assert.equal(
            readFileSync(
              path.join(pkg, 'ds-types/components/ui/stale.d.ts'),
              'utf8',
            ),
            'stale',
          );
        } else {
          assert.match(output, /ui\/fresh/);
          assert.doesNotMatch(output, /stale/);
          assert.equal(
            existsSync(path.join(pkg, 'ds-types/components/ui/stale.d.ts')),
            false,
          );
        }
        assert.deepEqual(
          readdirSync(pkg).filter((name) => name.startsWith('.ds-types-')),
          [],
        );
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
}
