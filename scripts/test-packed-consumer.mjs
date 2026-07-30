import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(projectRoot, 'test', 'fixtures', 'nest-cli-consumer');
const temporaryRoot = mkdtempSync(
  join(tmpdir(), 'nestm-standard-schema-consumer-'),
);
const consumerRoot = join(temporaryRoot, 'consumer');
const tarballPath = join(temporaryRoot, 'standard-schema.tgz');

try {
  run('pnpm', ['pack', '--out', tarballPath], projectRoot);
  cpSync(fixtureRoot, consumerRoot, { recursive: true });

  const packagePath = join(consumerRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const rootPackageJson = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf8'),
  );

  packageJson.dependencies['@nestm/standard-schema'] = `file:${tarballPath}`;
  synchronizeDependencyVersions(packageJson, rootPackageJson);
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  run(
    'pnpm',
    ['install', '--no-frozen-lockfile', '--prefer-offline', '--ignore-scripts'],
    consumerRoot,
  );
  run(
    'pnpm',
    ['exec', 'nest', 'build', '--config', 'nest-cli.json', '--builder', 'tsc'],
    consumerRoot,
  );
  run(
    'pnpm',
    [
      'exec',
      'nest',
      'build',
      '--config',
      'nest-cli.no-plugin.json',
      '--builder',
      'tsc',
    ],
    consumerRoot,
  );

  assertCompilerOutput(consumerRoot);
  run('node', ['verify.mjs'], consumerRoot);
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

function assertCompilerOutput(root) {
  const pluginJavaScript = readFileSync(
    join(root, 'dist', 'products.controller.js'),
    'utf8',
  );
  const plainJavaScript = readFileSync(
    join(root, 'dist-no-plugin', 'products.controller.js'),
    'utf8',
  );
  const pluginDeclaration = readFileSync(
    join(root, 'dist', 'products.controller.d.ts'),
    'utf8',
  );
  const plainDeclaration = readFileSync(
    join(root, 'dist-no-plugin', 'products.controller.d.ts'),
    'utf8',
  );

  if (
    !pluginJavaScript.includes('StandardSchemaResponse(ProductResponseDto)')
  ) {
    throw new Error('Nest CLI build did not inject response schema metadata.');
  }

  if (plainJavaScript.includes('_nestmStandardSchema')) {
    throw new Error(
      'The plugin-disabled build unexpectedly contains metadata.',
    );
  }

  if (pluginDeclaration !== plainDeclaration) {
    throw new Error('The compiler plugin changed declaration output.');
  }
}

function synchronizeDependencyVersions(consumerPackage, rootPackage) {
  for (const dependencyGroup of ['dependencies', 'devDependencies']) {
    for (const dependencyName of Object.keys(
      consumerPackage[dependencyGroup] ?? {},
    )) {
      if (dependencyName === '@nestm/standard-schema') {
        continue;
      }

      const rootVersion =
        rootPackage.dependencies?.[dependencyName] ??
        rootPackage.devDependencies?.[dependencyName];

      if (rootVersion !== undefined) {
        consumerPackage[dependencyGroup][dependencyName] = rootVersion;
      }
    }
  }
}

function run(command, arguments_, cwd) {
  execFileSync(command, arguments_, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
}
