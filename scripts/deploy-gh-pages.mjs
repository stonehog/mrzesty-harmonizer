#!/usr/bin/env node
/**
 * Rebuild dist/ for the custom domain mrzesty.com (writes CNAME) and force-push it to the
 * orphan gh-pages branch (single commit). Requires git push access to origin.
 *
 * Also publishes Nodie (Chrono Node Finder) at /nodie/: its static build is generated from the
 * Nodie source checkout (NODIE_DIR, default ../node_finder next to this repo) via
 * `python3 web/build.py <out>`. Only the built output is deployed; Nodie source stays in its own
 * repo. Set SKIP_NODIE=1 to deploy without it (this removes /nodie/ from the site).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const run = (file, args, cwd = root) =>
  execFileSync(file, args, { cwd, stdio: 'inherit' });

const nodieDir = resolve(process.env.NODIE_DIR || join(root, '..', 'node_finder'));
const skipNodie = process.env.SKIP_NODIE === '1';
if (!skipNodie && !existsSync(join(nodieDir, 'web', 'build.py'))) {
  console.error(
    `Nodie source not found at ${nodieDir} (need web/build.py). Set NODIE_DIR, or SKIP_NODIE=1 to drop /nodie/.`,
  );
  process.exit(1);
}

process.env.GITHUB_PAGES = 'true';
run('npm', ['run', 'build']);

const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
  cwd: root,
  encoding: 'utf8',
}).trim();

const work = mkdtempSync(join(tmpdir(), 'mrzesty-pages-'));
try {
  cpSync(join(root, 'dist'), work, { recursive: true });
  if (!skipNodie) run('python3', [join(nodieDir, 'web', 'build.py'), join(work, 'nodie')], nodieDir);
  writeFileSync(join(work, '.nojekyll'), '');
  writeFileSync(join(work, 'CNAME'), 'mrzesty.com\n');
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
      skipNodie ? 'Deploy MrZesty Harmonizer to GitHub Pages' : 'Deploy MrZesty Harmonizer (+ Nodie at /nodie/) to GitHub Pages',
    ],
    work,
  );
  run('git', ['remote', 'add', 'origin', remote], work);
  run('git', ['push', '--force', 'origin', 'gh-pages'], work);
} finally {
  rmSync(work, { recursive: true, force: true });
}
