import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

import ts from 'typescript';

interface NestCompilerPlugin {
  before(
    options?: Record<string, unknown>,
    program?: ts.Program,
  ): ts.TransformerFactory<ts.SourceFile>;
}

export interface CompileFixtureOptions {
  readonly compilerOptions?: ts.CompilerOptions;
  readonly pluginOptions?: Record<string, unknown>;
  readonly transformerPasses?: number;
  readonly usePlugin?: boolean;
}

export interface CompileFixtureResult {
  readonly diagnostics: readonly ts.Diagnostic[];
  readonly emitted: ReadonlyMap<string, string>;
  readonly pluginPath: string;
}

const require = createRequire(import.meta.url);
const pluginPath = require.resolve('@nestm/standard-schema/plugin');
const plugin = require(pluginPath) as NestCompilerPlugin;

export function compileFixture(
  files: Readonly<Record<string, string>>,
  options: CompileFixtureOptions = {},
): CompileFixtureResult {
  const fixtureRoot = mkdtempSync(join(process.cwd(), '.plugin-fixture-'));
  const outputRoot = join(fixtureRoot, 'output');

  try {
    const rootNames = Object.entries(files).map(([fileName, source]) => {
      const absolutePath = join(fixtureRoot, fileName);

      mkdirSync(dirname(absolutePath), { recursive: true });
      writeFileSync(absolutePath, source);

      return absolutePath;
    });
    const compilerOptions: ts.CompilerOptions = {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2023,
      lib: ['lib.es2023.d.ts'],
      rootDir: fixtureRoot,
      outDir: outputRoot,
      declaration: true,
      emitDecoratorMetadata: true,
      experimentalDecorators: true,
      skipLibCheck: true,
      strict: true,
      verbatimModuleSyntax: true,
      ...options.compilerOptions,
    };
    const program = ts.createProgram({
      rootNames,
      options: compilerOptions,
    });
    const emitted = new Map<string, string>();
    const passes = options.transformerPasses ?? 1;
    const before =
      options.usePlugin === false
        ? []
        : Array.from({ length: passes }, () =>
            plugin.before(options.pluginOptions, program),
          );
    const emitResult = program.emit(
      undefined,
      (fileName, data) => {
        emitted.set(relative(outputRoot, fileName).replaceAll('\\', '/'), data);
      },
      undefined,
      false,
      { before },
    );

    return {
      diagnostics: [
        ...ts.getPreEmitDiagnostics(program),
        ...emitResult.diagnostics,
      ],
      emitted,
      pluginPath,
    };
  } finally {
    rmSync(fixtureRoot, { force: true, recursive: true });
  }
}

export function formatDiagnostics(
  diagnostics: readonly ts.Diagnostic[],
): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  });
}
