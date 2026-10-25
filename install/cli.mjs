#!/usr/bin/env node
/**
 * adaptive-mastery installer.
 *
 * Vendors the kit into <target>/.adaptive-mastery/ and wires it into whichever agent
 * harness the project already uses. Idempotent: re-running replaces its own managed
 * block and regenerates vendored files without touching anything outside its markers.
 */
import { readFile, writeFile, mkdir, rm, readdir, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const VENDOR_DIR = '.adaptive-mastery';
const MARKER_BEGIN = '<!-- adaptive-mastery:begin';
const MARKER_END = '<!-- adaptive-mastery:end -->';
const SKILL_SLUG = 'adaptive-mastery';

const PAYLOAD = [
  'SKILL.md',
  'agents',
  'workflows',
  'templates',
  'config',
  'references',
  'tools',
  'docs',
];

const HARNESSES = ['agents', 'claude', 'cursor'];

const HELP = `adaptive-mastery — repository-aware learning system installer

Usage
  adaptive-mastery <command> [options]

Commands
  init       Vendor the kit and wire it into this project   (default)
  update     Re-sync an existing installation, keeping your own edits outside markers
  doctor     Check that an installation is complete and current
  uninstall  Remove managed files and the injected instruction block
  version    Print the installed and package versions
  help       Show this message

Options
  --target <dir>     Project to install into. Default: current directory
  --harness <list>   Comma list of: agents, claude, cursor, all. Default: auto-detect
  --dry-run          Report what would change, write nothing
  --force            Proceed despite local modifications or a non-empty target
  --quiet            Only print errors and the final summary
  --json             Machine-readable result on stdout

Exit codes: 0 success, 1 problem found, 2 usage error.
`;

/* ------------------------------------------------------------------ utils */

function toPosix(p) {
  return sep === '/' ? p : p.split(sep).join('/');
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function sha256File(p) {
  return createHash('sha256').update(await readFile(p)).digest('hex');
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (entry.isFile()) out.push(toPosix(relative(base, full)));
  }
  return out.sort();
}

function createLogger({ quiet, json }) {
  const lines = [];
  return {
    lines,
    info(message) {
      if (!quiet && !json) process.stdout.write(`${message}\n`);
    },
    warn(message) {
      if (!json) process.stderr.write(`warning: ${message}\n`);
      lines.push(`warning: ${message}`);
    },
    error(message) {
      process.stderr.write(`error: ${message}\n`);
      lines.push(`error: ${message}`);
    },
    summary(message) {
      if (!json) process.stdout.write(`${message}\n`);
    },
  };
}

/* ---------------------------------------------------------------- package */

async function readPackage() {
  const pkg = JSON.parse(await readFile(join(PKG_ROOT, 'package.json'), 'utf8'));
  return { name: pkg.name, version: pkg.version };
}

/* --------------------------------------------------------------- payload */

async function payloadFiles() {
  const files = [];
  for (const entry of PAYLOAD) {
    const full = join(PKG_ROOT, entry);
    if (!(await exists(full))) continue;
    const info = await stat(full);
    if (info.isDirectory()) {
      const inner = await walk(full, full);
      for (const rel of inner) files.push(toPosix(join(entry, rel)));
    } else {
      files.push(entry);
    }
  }
  return files.sort();
}

async function copyPayload({ target, sourceRoot, dryRun, log }) {
  const vendorRoot = join(target, VENDOR_DIR);
  const files = [];
  for (const entry of PAYLOAD) {
    const from = join(sourceRoot, entry);
    if (!(await exists(from))) continue;
    const info = await stat(from);
    const targets = info.isDirectory()
      ? (await walk(from, from)).map((rel) => ({ rel: toPosix(join(entry, rel)), from: join(from, rel) }))
      : [{ rel: entry, from }];

    for (const { rel, from: src } of targets) {
      const dest = join(vendorRoot, rel);
      if (!dryRun) {
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, await readFile(src));
      }
      files.push({ rel, sha256: await sha256File(src) });
    }
  }
  log.info(`  vendored ${files.length} files -> ${toPosix(join(VENDOR_DIR, ''))}`);
  return files;
}

async function pruneVendor({ target, files, dryRun, log }) {
  const vendorRoot = join(target, VENDOR_DIR);
  if (!(await exists(vendorRoot))) return 0;
  const keep = new Set(files.map((f) => toPosix(f.rel)));
  keep.add('install.json');
  let removed = 0;
  for (const rel of await walk(vendorRoot, vendorRoot)) {
    if (keep.has(rel)) continue;
    if (!dryRun) await rm(join(vendorRoot, rel), { force: true });
    removed += 1;
  }
  if (removed) log.info(`  pruned ${removed} stale file(s)`);
  return removed;
}

/* ----------------------------------------------------------------- block */

function blockBody(template, { version, dir }) {
  return template
    .replaceAll('{{VERSION}}', version)
    .replaceAll('{{DIR}}', dir)
    .replaceAll('{{BEGIN}}', `${MARKER_BEGIN} v${version} -->`)
    .replaceAll('{{END}}', MARKER_END);
}

async function readTemplate(relPath) {
  return readFile(join(PKG_ROOT, 'install', relPath), 'utf8');
}

function blockPattern() {
  return new RegExp(
    `${escapeRe(MARKER_BEGIN)}[^>]*-->[\\s\\S]*?${escapeRe(MARKER_END)}`,
    'm',
  );
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function applyBlock({ file, block, dryRun, log, label, base }) {
  const normalized = `${block.trimEnd()}\n`;
  const trimmed = normalized.trimEnd();
  const existsAlready = await exists(file);
  const current = existsAlready ? await readFile(file, 'utf8') : '';
  const pattern = blockPattern();
  const has = pattern.test(current);

  let next;
  let action;
  if (has) {
    // The pattern stops at the end marker, so replacing with the trimmed body
    // preserves whatever newline already follows it.
    next = current.replace(pattern, trimmed);
    action = next === current ? 'unchanged' : 'replaced';
  } else if (current.trim() === '') {
    next = normalized;
    action = 'created';
  } else {
    next = `${current.trimEnd()}\n\n${normalized}`;
    action = 'appended';
  }

  if (action !== 'unchanged' && !dryRun) await writeFile(file, next);
  const shown = base ? toPosix(relative(base, file)) : toPosix(file);
  log.info(`  ${label}: ${action} (${shown})`);
  return action;
}

async function stripBlock({ file, dryRun, log, label }) {
  if (!(await exists(file))) return 'absent';
  const current = await readFile(file, 'utf8');
  const pattern = new RegExp(
    `\\n*${escapeRe(MARKER_BEGIN)}[^>]*-->[\\s\\S]*?${escapeRe(MARKER_END)}\\n*`,
    'm',
  );
  if (!pattern.test(current)) return 'absent';
  // Only normalize the whitespace left where the block was. Never collapse blank
  // lines elsewhere: they may be meaningful Markdown or code fences.
  const next = current.replace(pattern, '\n').replace(/\n+$/, '');
  if (!dryRun) await writeFile(file, next ? `${next}\n` : '');
  log.info(`  ${label}: removed managed block`);
  return 'removed';
}

/* -------------------------------------------------------------- adapters */

async function detectHarnesses(target) {
  const found = new Set();
  if ((await exists(join(target, 'AGENTS.md'))) || (await exists(join(target, '.git')))) {
    found.add('agents');
  }
  if ((await exists(join(target, '.claude'))) || (await exists(join(target, 'CLAUDE.md')))) {
    found.add('claude');
  }
  if (await exists(join(target, '.cursor'))) found.add('cursor');
  if (found.size === 0) found.add('agents');
  return [...found].sort();
}

function parseHarnesses(raw) {
  if (!raw) return null;
  const parts = raw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.includes('all')) return [...HARNESSES];
  const invalid = parts.filter((p) => !HARNESSES.includes(p));
  if (invalid.length) {
    throw new Error(`unknown harness: ${invalid.join(', ')} (expected ${HARNESSES.join(', ')} or all)`);
  }
  return [...new Set(parts)].sort();
}

async function writeAdapters({ target, harnesses, version, dryRun, log }) {
  const written = {};
  const block = blockBody(await readTemplate('block.md'), { version, dir: VENDOR_DIR });

  if (harnesses.includes('agents')) {
    written.agents = await applyBlock({
      file: join(target, 'AGENTS.md'),
      block,
      dryRun,
      log,
      label: 'AGENTS.md',
      base: target,
    });
  }

  if (harnesses.includes('claude')) {
    const skillFile = join(target, '.claude', 'skills', SKILL_SLUG, 'SKILL.md');
    if (!dryRun) {
      await mkdir(dirname(skillFile), { recursive: true });
      // The skill needs its siblings beside SKILL.md, so vendor a copy here too.
      for (const entry of PAYLOAD) {
        const from = join(PKG_ROOT, entry);
        if (!(await exists(from))) continue;
        const info = await stat(from);
        const items = info.isDirectory()
          ? (await walk(from, from)).map((rel) => ({ rel: join(entry, rel), from: join(from, rel) }))
          : [{ rel: entry, from }];
        for (const item of items) {
          const dest = join(dirname(skillFile), item.rel);
          await mkdir(dirname(dest), { recursive: true });
          await writeFile(dest, await readFile(item.from));
        }
      }
    }
    log.info('  .claude/skills/adaptive-mastery/: vendored skill');
    const claudeMd = await applyBlock({
      file: join(target, 'CLAUDE.md'),
      block,
      dryRun,
      log,
      label: 'CLAUDE.md',
      base: target,
    });
    written.claude = {
      skill: toPosix(join('.claude', 'skills', SKILL_SLUG, 'SKILL.md')),
      claudeMd,
    };
  }

  if (harnesses.includes('cursor')) {
    const rule = join(target, '.cursor', 'rules', `${SKILL_SLUG}.mdc`);
    if (!dryRun) {
      await mkdir(dirname(rule), { recursive: true });
      await writeFile(
        rule,
        (await readTemplate('cursor-rule.mdc'))
          .replaceAll('{{VERSION}}', version)
          .replaceAll('{{DIR}}', VENDOR_DIR),
      );
    }
    log.info('  .cursor/rules/adaptive-mastery.mdc: written');
    written.cursor = toPosix(join('.cursor', 'rules', `${SKILL_SLUG}.mdc`));
  }

  return written;
}

/* --------------------------------------------------------------- manifest */

function manifestPath(target) {
  return join(target, VENDOR_DIR, 'install.json');
}

async function readManifest(target) {
  const file = manifestPath(target);
  if (!(await exists(file))) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function writeManifest({ target, version, harnesses, files, adapters, dryRun }) {
  const previous = await readManifest(target);
  const now = new Date().toISOString();
  const manifest = {
    schema: 1,
    package: 'adaptive-mastery',
    version,
    installed_at: previous?.installed_at ?? now,
    updated_at: now,
    harnesses,
    adapters,
    files,
  };
  if (!dryRun) {
    await mkdir(join(target, VENDOR_DIR), { recursive: true });
    await writeFile(manifestPath(target), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return manifest;
}

/* ---------------------------------------------------------------- actions */

function resolveTarget(raw) {
  return resolve(raw ?? process.cwd());
}

async function guardTarget({ target, force, log, command }) {
  if (resolve(target) === PKG_ROOT) {
    log.error('refusing to install into the kit repository itself; pass --target <project>');
    return false;
  }
  if (!(await exists(target))) {
    log.error(`target does not exist: ${target}`);
    return false;
  }
  const info = await stat(target);
  if (!info.isDirectory()) {
    log.error(`target is not a directory: ${target}`);
    return false;
  }
  if (command === 'init' && !force) {
    const manifest = await readManifest(target);
    if (manifest) {
      log.warn('an installation already exists; use "update" to re-sync (continuing anyway)');
    }
  }
  return true;
}

async function detectLocalModifications({ target, manifest }) {
  const changed = [];
  if (!manifest?.files) return changed;
  for (const entry of manifest.files) {
    const file = join(target, VENDOR_DIR, entry.rel);
    if (!(await exists(file))) {
      changed.push(`${entry.rel} (missing)`);
      continue;
    }
    if ((await sha256File(file)) !== entry.sha256) changed.push(entry.rel);
  }
  return changed;
}

async function install({ target, harnesses: requested, dryRun, force, log, command }) {
  const { version } = await readPackage();
  const ok = await guardTarget({ target, force, log, command });
  if (!ok) return 1;

  const existing = await readManifest(target);
  if (command === 'update' && !existing) {
    log.error('no installation found here; run "init" first');
    return 1;
  }

  if (existing && !force) {
    const modified = await detectLocalModifications({ target, manifest: existing });
    if (modified.length) {
      log.error(
        `vendored files were modified locally:\n  ${modified.join('\n  ')}\nRe-run with --force to overwrite them.`,
      );
      return 1;
    }
  }

  const harnesses = requested ?? (existing?.harnesses ?? (await detectHarnesses(target)));
  log.info(`${command === 'update' ? 'Updating' : 'Installing'} adaptive-mastery ${version} -> ${toPosix(target)}`);
  log.info(`  harnesses: ${harnesses.join(', ')}`);

  const files = await copyPayload({ target, sourceRoot: PKG_ROOT, dryRun, log });
  await pruneVendor({ target, files, dryRun, log });
  const adapters = await writeAdapters({ target, harnesses, version, dryRun, log });
  const manifest = await writeManifest({ target, version, harnesses, files, adapters, dryRun });

  log.summary(
    [
      '',
      dryRun ? 'Dry run complete — nothing was written.' : `Installed adaptive-mastery ${version}.`,
      `  kit:      ${toPosix(join(VENDOR_DIR, ''))}`,
      `  manifest: ${toPosix(join(VENDOR_DIR, 'install.json'))}`,
      '',
      'Next step: open the project in your agent and ask it to initialize the learning library.',
      '  "Initialize the Adaptive Mastery System for this repository."',
      '',
    ].join('\n'),
  );
  return { code: 0, manifest };
}

async function doctor({ target, log, json }) {
  const problems = [];
  const notes = [];

  if (!(await exists(target))) {
    log.error(`target does not exist: ${target}`);
    return 1;
  }

  const manifest = await readManifest(target);
  if (!manifest) {
    log.error(`no installation found at ${toPosix(target)} (missing ${VENDOR_DIR}/install.json)`);
    return 1;
  }

  const { version: pkgVersion } = await readPackage();
  if (manifest.version !== pkgVersion) {
    notes.push(`installed ${manifest.version}, package ${pkgVersion} — run "update"`);
  }

  const modified = await detectLocalModifications({ target, manifest });
  for (const entry of modified) problems.push(`vendored file changed or missing: ${entry}`);

  for (const harness of manifest.harnesses) {
    if (harness === 'agents') {
      const file = join(target, 'AGENTS.md');
      const present = (await exists(file)) && blockPattern().test(await readFile(file, 'utf8'));
      if (!present) problems.push('AGENTS.md is missing the managed block');
    }
    if (harness === 'claude') {
      const skill = join(target, '.claude', 'skills', SKILL_SLUG, 'SKILL.md');
      if (!(await exists(skill))) problems.push('Claude skill SKILL.md is missing');
    }
    if (harness === 'cursor') {
      const rule = join(target, '.cursor', 'rules', `${SKILL_SLUG}.mdc`);
      if (!(await exists(rule))) problems.push('Cursor rule is missing');
    }
  }

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) problems.push(`Node ${process.versions.node} is older than the supported 18`);
  if (manifest.harnesses.length === 0) problems.push('no harness recorded in the manifest');

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ok: problems.length === 0, version: manifest.version, harnesses: manifest.harnesses, problems, notes }, null, 2)}\n`,
    );
  } else {
    log.info(`adaptive-mastery ${manifest.version} at ${toPosix(target)}`);
    log.info(`  harnesses: ${manifest.harnesses.join(', ') || '(none)'}`);
    log.info(`  files:     ${manifest.files.length}`);
    for (const note of notes) log.info(`  note: ${note}`);
    if (problems.length === 0) log.summary('\nInstallation is healthy.');
    else {
      log.warn(`${problems.length} problem(s) found`);
      for (const problem of problems) log.error(problem);
    }
  }
  return problems.length === 0 ? 0 : 1;
}

async function uninstall({ target, dryRun, log }) {
  const manifest = await readManifest(target);
  if (!manifest) {
    log.warn(`no installation found at ${toPosix(target)}; nothing to remove`);
    return 0;
  }

  log.info(`Removing adaptive-mastery ${manifest.version} from ${toPosix(target)}`);

  for (const harness of manifest.harnesses ?? []) {
    if (harness === 'agents') {
      await stripBlock({ file: join(target, 'AGENTS.md'), dryRun, log, label: 'AGENTS.md' });
    }
    if (harness === 'claude') {
      const skillDir = join(target, '.claude', 'skills', SKILL_SLUG);
      if (!dryRun) await rm(skillDir, { recursive: true, force: true });
      log.info('  .claude/skills/adaptive-mastery/: removed');
      await stripBlock({ file: join(target, 'CLAUDE.md'), dryRun, log, label: 'CLAUDE.md' });
    }
    if (harness === 'cursor') {
      const rule = join(target, '.cursor', 'rules', `${SKILL_SLUG}.mdc`);
      if (!dryRun) await rm(rule, { force: true });
      log.info('  .cursor/rules/adaptive-mastery.mdc: removed');
    }
  }

  if (!dryRun) await rm(join(target, VENDOR_DIR), { recursive: true, force: true });
  log.info(`  ${VENDOR_DIR}/: removed`);
  log.summary('\nUninstalled. Files outside the managed block were left untouched.');
  return 0;
}

/* ------------------------------------------------------------------- main */

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    command: 'init',
    target: null,
    harness: null,
    dryRun: false,
    force: false,
    quiet: false,
    json: false,
  };

  const commands = ['init', 'update', 'doctor', 'uninstall', 'version', 'help'];
  if (args.length && !args[0].startsWith('-')) {
    const command = args[0].toLowerCase();
    if (!commands.includes(command)) {
      throw new Error(`unknown command: ${args[0]}`);
    }
    options.command = command;
    args.shift();
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const takeValue = (name) => {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
      return value;
    };
    if (arg === '--target') options.target = takeValue('--target');
    else if (arg.startsWith('--target=')) options.target = arg.slice('--target='.length);
    else if (arg === '--harness') options.harness = takeValue('--harness');
    else if (arg.startsWith('--harness=')) options.harness = arg.slice('--harness='.length);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.command = 'help';
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`error: ${error.message}\n\n${HELP}`);
    return 2;
  }

  if (options.command === 'help') {
    process.stdout.write(HELP);
    return 0;
  }

  const log = createLogger({ quiet: options.quiet, json: options.json });
  const target = resolveTarget(options.target);

  if (options.command === 'version') {
    const { name, version } = await readPackage();
    const manifest = await readManifest(target);
    process.stdout.write(
      `${name} ${version}\ninstalled: ${manifest ? manifest.version : 'not installed'}\n`,
    );
    return 0;
  }

  try {
    const harnesses = parseHarnesses(options.harness);
    if (options.command === 'doctor') return await doctor({ target, log, json: options.json });
    if (options.command === 'uninstall') {
      return await uninstall({ target, dryRun: options.dryRun, log });
    }
    const result = await install({
      target,
      harnesses,
      dryRun: options.dryRun,
      force: options.force,
      log,
      command: options.command,
    });
    if (typeof result === 'number') return result;
    if (options.json) process.stdout.write(`${JSON.stringify(result.manifest, null, 2)}\n`);
    return 0;
  } catch (error) {
    log.error(error.message);
    return 1;
  }
}

const invokedDirectly = await isDirectInvocation();

if (invokedDirectly) {
  process.exitCode = await main();
}

async function isDirectInvocation() {
  const { realpathSync } = await import('node:fs');
  const thisFile = fileURLToPath(import.meta.url);
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(thisFile);
  } catch {
    return resolve(process.argv[1]) === resolve(thisFile);
  }
}
