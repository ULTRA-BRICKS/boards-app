import { mkdtemp, mkdir, writeFile, readFile, copyFile, rename, rm, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const exists = async (path) =>
  stat(path).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
/** A fixed browser entry uses the shared state compiler, never a second optimizer. */
export async function compileBoard({ out, backend, prepare, specialize = true }) {
  if (!['baseline', 'state-lib'].includes(backend)) throw Error('Compilation requires an explicit state backend');
  await mkdir('dist', { recursive: true });
  const stage = await mkdtemp(resolve('dist/.state-entry-'));
  let published = false;
  try {
    const src = join(stage, 'src');
    await mkdir(src);
    await prepare(src);
    // Preserve the library's authored sideEffects/exports contract during bundling.
    await copyFile(resolve('packages/state-lib/package.json'), join(src, 'packages/state-lib/package.json'));
    const config = {
      version: 1,
      sourceRoot: 'src',
      browserRoot: 'src',
      entry: 'src/boot.mjs',
      outDir: 'compiled',
      targets: ['browser'],
      capabilities: [],
      metrics: ['latency', 'bytes'],
      cases: ['application'],
      minimumSamples: 3,
      units: [],
      buildConstants: specialize
        ? { __STATE_BUILD_BASELINE__: backend === 'baseline', __STATE_BUILD_COW__: false }
        : {},
      budgets: { maxRawBytes: 200000, maxGzipBytes: 68690, maxBrotliBytes: 68690 },
    };
    const configPath = join(stage, 'state.config.json');
    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n');
    const cli = process.env.STATE_BUILD_CLI;
    const command = cli ? 'python3' : 'state';
    const args = [...(cli ? [resolve(cli)] : []), 'build', '--config', configPath];
    let output;
    try {
      output = execFileSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch (error) {
      throw Error('state build failed: ' + String(error.stderr || error.message));
    }
    const manifest = JSON.parse(output);
    if (
      manifest.phase !== 'emitted-and-size-checked' ||
      (specialize && manifest.buildConstants.__STATE_BUILD_BASELINE__ !== (backend === 'baseline'))
    )
      throw Error('Compiler did not confirm the requested fixed entry');
    const html = await readFile(join(src, 'index.html'), 'utf8');
    if (html.split('/boot.mjs').length !== 2) throw Error('Expected one browser bootstrap');
    const ready = join(stage, 'compiled');
    await writeFile(join(ready, 'index.html'), html.replace('/boot.mjs', '/app.js'));
    for (const file of ['style.css', 'refinements.css', 'placeholder.svg'])
      await copyFile(join(src, file), join(ready, file));
    const previous = join(stage, 'previous');
    if (await exists(out)) await rename(out, previous);
    try {
      await rename(ready, out);
      published = true;
    } catch (error) {
      if (await exists(previous)) await rename(previous, out);
      throw error;
    }
    console.log(
      `Built ${out} with state build (${backend}, ${specialize ? 'specialized' : 'bundle-only control'}); full-entry limits passed.`,
    );
  } finally {
    // If restoring an earlier output itself fails, keep its only copy for recovery.
    if (published || !(await exists(join(stage, 'previous')))) await rm(stage, { recursive: true, force: true });
  }
}
