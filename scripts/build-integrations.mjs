// Bundle local bridge code while leaving native host SDKs outside the runtime artifact.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await Promise.all([
  ['integrations/dsh/index.ts', 'integrations/dsh/dist/index.js'],
  ['integrations/pi/extension.ts', 'integrations/pi/dist/index.js'],
].map(async ([entry, output]) => {
  await build({
    entryPoints: [resolve(root, entry)],
    outfile: resolve(root, output),
    bundle: true,
    packages: 'external',
    platform: 'node',
    target: 'node22',
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
  });
}));
