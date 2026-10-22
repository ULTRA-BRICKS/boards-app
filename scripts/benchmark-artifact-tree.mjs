// Content manifest of a read-only artifact tree for scripts/benchmark-compiled-board-actions.mjs.
// The driver hashes every file of each measured build before the run, after every family and at the
// end, and refuses to report numbers when any file changed, appeared or disappeared. It only reads.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, readlinkSync, lstatSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/**
 * {root, files: [{path, size, sha256}] sorted by path, digest, bodies}. Every regular file is read
 * once; bodies maps its path to exactly the bytes that were hashed, so the driver serves the hashed
 * snapshot and a concurrent rewrite of the directory cannot reach a page. Symlinks are recorded by
 * target, never followed, and have no body.
 */
export function snapshotTree(root) {
  const files = [],
    bodies = new Map();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name),
        stat = lstatSync(path),
        rel = relative(root, path).split(sep).join('/');
      if (stat.isDirectory()) walk(path);
      else if (stat.isSymbolicLink()) files.push({ path: rel, size: 0, sha256: 'symlink:' + sha256(readlinkSync(path)) });
      // FIFOs, sockets and devices are recorded by kind and never read (a read could block forever).
      else if (!stat.isFile()) files.push({ path: rel, size: 0, sha256: 'special:' + stat.mode.toString(8) });
      else {
        const body = readFileSync(path);
        bodies.set(rel, body);
        files.push({ path: rel, size: body.length, sha256: sha256(body) });
      }
    }
  };
  walk(root);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { root, files, digest: treeDigest(files), bodies };
}

/** {root, files, digest} of snapshotTree without the bodies. */
export function hashTree(root) {
  const { bodies, ...manifest } = snapshotTree(root);
  return manifest;
}

/** Digest of a sorted manifest file list; the receipt recomputes it from recorded files. */
export const treeDigest = (files) => sha256(files.map((f) => f.path + '\0' + f.sha256).join('\n'));

/** Human-readable differences between two manifests of the same tree; empty means byte-identical. */
export function compareTrees(before, after) {
  const was = new Map(before.files.map((f) => [f.path, f.sha256])),
    now = new Map(after.files.map((f) => [f.path, f.sha256]));
  const out = [];
  for (const [path, hash] of was)
    if (!now.has(path)) out.push('removed: ' + path);
    else if (now.get(path) !== hash) out.push('changed: ' + path);
  for (const path of now.keys()) if (!was.has(path)) out.push('added: ' + path);
  return out;
}
