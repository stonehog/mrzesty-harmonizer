#!/usr/bin/env node
/**
 * Rebuild dist/ with the GitHub Pages base path and force-push it to the
 * orphan gh-pages branch (single commit). Requires git push access to origin.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (file, args, cwd = root) =>
  execFileSync(file, args, { cwd, stdio: 'inherit' });

process.env.GITHUB_PAGES = 'true';
run('npm', ['run', 'build']);

const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
  cwd: root,
  encoding: 'utf8',
}).trim();

const work = mkdtempSync(join(tmpdir(), 'mrzesty-pages-'));
try {
  cpSync(join(root, 'dist'), work, { recursive: true });
  writeFileSync(join(work, '.nojekyll'), '');
  run('git', ['init'], work);
  run('git', ['checkout', '-B', 'gh-pages'], work);
  run('git', ['config', 'user.name', 'Smedley'], work);
  run('git', ['config', 'user.email', 'smedley-gb@stonehog.com'], work);
  run('git', ['add', '-A'], work);
  run(
    'git',
    [
      '-c',
      'user.name=Smedley',
      '-c',
      'user.email=smedley-gb@stonehog.com',
      'commit',
      '-m',
      'Deploy MrZesty Harmonizer to GitHub Pages',
    ],
    work,
  );
  run('git', ['remote', 'add', 'origin', remote], work);
  run('git', ['push', '--force', 'origin', 'gh-pages'], work);
} finally {
  rmSync(work, { recursive: true, force: true });
}
