import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exampleRoot = join(projectRoot, 'examples', 'nest-cli-zod');
const temporaryRoot = mkdtempSync(
  join(tmpdir(), 'nestm-standard-schema-consumer-'),
);
const consumerRoot = join(temporaryRoot, 'consumer');
const tarballPath = join(temporaryRoot, 'standard-schema.tgz');

try {
  run('pnpm', ['pack', '--out', tarballPath], projectRoot);
  cpSync(exampleRoot, consumerRoot, {
    recursive: true,
    filter: shouldCopyExamplePath,
  });

  const packagePath = join(consumerRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const rootPackageJson = JSON.parse(
    readFileSync(join(projectRoot, 'package.json'), 'utf8'),
  );

  packageJson.dependencies['@nestm/standard-schema'] = `file:${tarballPath}`;
  synchronizeDependencyVersions(packageJson, rootPackageJson);
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  writeStandaloneWorkspaceConfig(consumerRoot);
  writePluginDisabledConfigs(consumerRoot);

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
  run('node', ['test/smoke.mjs'], consumerRoot);
  run('node', ['test/smoke.mjs'], consumerRoot, {
    EXAMPLE_OUTPUT_DIRECTORY: 'dist-no-plugin',
    EXAMPLE_PLUGIN_ENABLED: 'false',
  });
} finally {
  rmSync(temporaryRoot, { force: true, recursive: true });
}

function shouldCopyExamplePath(source) {
  const relativePath = relative(exampleRoot, source);
  const excludedDirectories = new Set([
    'coverage',
    'dist',
    'dist-no-plugin',
    'node_modules',
  ]);

  if (
    relativePath.split(sep).some((segment) => excludedDirectories.has(segment))
  ) {
    return false;
  }

  const fileName = basename(source);

  return (
    fileName !== 'pnpm-lock.yaml' &&
    !fileName.startsWith('.env') &&
    !fileName.endsWith('.log')
  );
}

function writeStandaloneWorkspaceConfig(root) {
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    `packages:
  - '.'

peerDependencyRules:
  allowedVersions:
    '@nestjs/common': '12'
    '@nestjs/core': '12'
    '@nestjs/platform-express': '12'

overrides:
  multer: '2.2.0'

allowBuilds:
  '@nestjs/core': false
`,
  );
}

function assertCompilerOutput(root) {
  const pluginJavaScript = readFileSync(
    join(root, 'dist', 'products', 'products.controller.js'),
    'utf8',
  );
  const plainJavaScript = readFileSync(
    join(root, 'dist-no-plugin', 'products', 'products.controller.js'),
    'utf8',
  );
  const pluginDeclaration = readFileSync(
    join(root, 'dist', 'products', 'products.controller.d.ts'),
    'utf8',
  );
  const plainDeclaration = readFileSync(
    join(root, 'dist-no-plugin', 'products', 'products.controller.d.ts'),
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

function writePluginDisabledConfigs(root) {
  writeFileSync(
    join(root, 'nest-cli.no-plugin.json'),
    `${JSON.stringify(
      {
        $schema: 'https://json.schemastore.org/nest-cli',
        sourceRoot: 'src',
        compilerOptions: {
          builder: 'tsc',
          deleteOutDir: true,
          tsConfigPath: 'tsconfig.no-plugin.json',
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(root, 'tsconfig.no-plugin.json'),
    `${JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: {
          outDir: './dist-no-plugin',
        },
      },
      null,
      2,
    )}\n`,
  );
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

function run(command, arguments_, cwd, environment = {}) {
  execFileSync(command, arguments_, {
    cwd,
    env: {
      ...process.env,
      ...environment,
    },
    stdio: 'inherit',
  });
}
