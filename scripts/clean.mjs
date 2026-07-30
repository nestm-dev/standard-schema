import { rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const buildDirectory = resolve(import.meta.dirname, '../dist');

if (basename(buildDirectory) !== 'dist') {
  throw new Error(`Refusing to clean unexpected path: ${buildDirectory}`);
}

rmSync(buildDirectory, {
  force: true,
  recursive: true,
});
