import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const changesetsBin = require.resolve('@changesets/cli/bin.js');
const publishArguments = [changesetsBin, 'publish'];

try {
  const preState = JSON.parse(
    readFileSync(new URL('../.changeset/pre.json', import.meta.url), 'utf8'),
  );

  if (preState.mode === 'pre') {
    if (typeof preState.tag !== 'string' || preState.tag.length === 0) {
      throw new Error('Changesets prerelease mode requires a non-empty tag');
    }

    publishArguments.push('--tag', preState.tag);
  }
} catch (error) {
  if (
    !(error instanceof Error) ||
    !('code' in error) ||
    error.code !== 'ENOENT'
  ) {
    throw new Error('Could not resolve the Changesets publish tag', {
      cause: error,
    });
  }
}

const result = spawnSync(process.execPath, publishArguments, {
  stdio: 'inherit',
});

if (result.error) {
  throw new Error('Could not start Changesets publish', {
    cause: result.error,
  });
}

if (result.signal !== null) {
  throw new Error(`Changesets publish terminated with ${result.signal}`);
}

process.exitCode = result.status ?? 1;
