#!/usr/bin/env node
/**
 * adaptive-mastery CLI & installer.
 *
 * Vendors the immutable kit into <target>/.adaptive-mastery/, seeds mutable user state in
 * docs/learning/ (only if absent), and wires lightweight pointer adapters into whichever agent
 * harness(es) the project uses via a data-driven harness registry.
 */
import { readFile, writeFile, mkdir, rm, readdir, stat, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as preflightMain, validateRepositoryState } from '../tools/preflight-review.mjs';

const PKG_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const VENDOR_DIR = '.adaptive-mastery';
const MARKER_BEGIN = '<!-- adaptive-mastery:begin';
const MARKER_END = '<!-- adaptive-mastery:end -->';
const SKILL_SLUG = 'adaptive-mastery';

/**
 * Immutable kit payload vendored into `.adaptive-mastery/`.
 * Excludes `docs/` so maintainer-only files (`docs/RELEASING.md`) never land in user repos.
 * Includes `CURRICULUM_FORMAT.md` and `install/` so local CLI invocations work standalone.
 */
export const PAYLOAD = [
  'SKILL.md',
  'CURRICULUM_FORMAT.md',
  'agents',
  'workflows',
  'templates',
  'config',
  'references',
  'tools',
  'install',
];

/**
 * Data-driven harness registry.
 * Adding a harness is a single entry here plus a table-driven test.
 */
export const HARNESS_REGISTRY = [
  {
    id: 'agents',
    detect: ['AGENTS.md'],
    write: { kind: 'block', file: 'AGENTS.md', template: 'block.md' },
  },
  {
    id: 'claude',
    detect: ['.claude', 'CLAUDE.md'],
    write: {
      kind: 'claude',
      file: 'CLAUDE.md',
      skillFile: `.claude/skills/${SKILL_SLUG}/SKILL.md`,
      skillTemplate: 'claude-skill.md',
    },
  },
  {
    id: 'cursor',
    detect: ['.cursor'],
    write: { kind: 'file', file: `.cursor/rules/${SKILL_SLUG}.mdc`, template: 'cursor-rule.mdc' },
  },
  {
    id: 'copilot',
    detect: ['.github/copilot-instructions.md'],
    write: { kind: 'block', file: '.github/copilot-instructions.md', template: 'block.md' },
  },
  {
    id: 'gemini',
    detect: ['GEMINI.md', '.gemini'],
    write: { kind: 'block', file: 'GEMINI.md', template: 'block.md' },
  },
  {
    id: 'windsurf',
    detect: ['.windsurf', '.windsurfrules'],
    write: { kind: 'file', file: `.windsurf/rules/${SKILL_SLUG}.md`, template: 'stub.md' },
  },
  {
    id: 'cline',
    detect: ['.clinerules'],
    write: { kind: 'file', file: `.clinerules/${SKILL_SLUG}.md`, template: 'stub.md' },
  },
  {
    id: 'aider',
    detect: ['.aider.conf.yml'],
    write: { kind: 'block', file: 'CONVENTIONS.md', template: 'block.md' },
  },
];

export const HARNESSES = HARNESS_REGISTRY.map((h) => h.id);

const LOCAL_CONFIG_SEED = `# Project-local overrides for Adaptive Mastery System.
# Values here override .adaptive-mastery/config/mastery-system.yaml and survive kit updates.
#
# paths:
#   learning_root: docs/learning
#
# bootstrap:
#   default_mode: lazy
#
# review:
#   max_parallel_reviews: 3
`;

const LEARNING_GITIGNORE_SEED = `# Personal learner state and session checkpoints are local by default.
# Remove lines below if your team wants to share learner state in git.
progress.json
learner-profile.yaml
`;

const HELP = `adaptive-mastery — repository-aware learning system CLI

Usage
  adaptive-mastery <command> [options]

Commands
  init       Vendor the kit and wire it into this project   (default)
  update     Re-sync an existing installation, keeping your own edits outside markers
  doctor     Check that an installation and its adapters are complete and unmodified
  uninstall  Remove managed files and injected instruction blocks
  preflight  Run Stage-0 deterministic checks on a feature guide
  validate   Validate progress.json, feature-register.yaml, staleness, and file coverage
  print      Print the rendered instruction block to stdout (for custom instruction boxes)
  bundle     Produce a single self-contained ADAPTIVE_MASTERY.md for chat/web UIs
  version    Print the installed and package versions
  help       Show this message

Options
  --target <dir>     Project directory. Default: current directory
  --harness <list>   Comma list of: ${HARNESSES.join(', ')}, custom, all. Default: auto-detect
  --file <path>      Target file when using --harness custom
  --out <path>       Output file for bundle (default: ADAPTIVE_MASTERY.md in target)
  --dry-run          Report what would change, write nothing
  --force            Proceed despite local modifications to vendored files
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

/**
 * Compute SHA-256 over LF-normalized text so Windows core.autocrlf never causes false drift.
 */
export function sha256Normalized(content) {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

async function sha256File(p) {
  return sha256Normalized(await readFile(p, 'utf8'));
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

function isColorEnabled(noColorFlag = false) {
  if (noColorFlag || process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout.isTTY);
}

function createTheme(enabled = isColorEnabled()) {
  const wrap = (open, close = '\x1b[0m') => (text) => (enabled ? `${open}${text}${close}` : String(text));
  return {
    enabled,
    bold: wrap('\x1b[1m', '\x1b[22m'),
    dim: wrap('\x1b[2m', '\x1b[22m'),
    italic: wrap('\x1b[3m', '\x1b[23m'),
    cyan: wrap('\x1b[36m'),
    brightCyan: wrap('\x1b[96m'),
    green: wrap('\x1b[32m'),
    emerald: wrap('\x1b[92m'),
    yellow: wrap('\x1b[33m'),
    amber: wrap('\x1b[93m'),
    red: wrap('\x1b[31m'),
    rose: wrap('\x1b[91m'),
    magenta: wrap('\x1b[35m'),
    violet: wrap('\x1b[95m'),
    white: wrap('\x1b[97m'),
    gray: wrap('\x1b[90m'),
    bgCyan: wrap('\x1b[46m\x1b[30m\x1b[1m'),
    bgEmerald: wrap('\x1b[102m\x1b[30m\x1b[1m'),
    bgViolet: wrap('\x1b[45m\x1b[97m\x1b[1m'),
    bgAmber: wrap('\x1b[43m\x1b[30m\x1b[1m'),
    bgRose: wrap('\x1b[41m\x1b[97m\x1b[1m'),
  };
}

function renderBanner(t, version, subtitle = null) {
  const arrow = t.gray('──►');
  const pipeline = [
    t.brightCyan('Discover'),
    t.cyan('Order'),
    t.violet('Author'),
    t.amber('Preflight'),
    t.emerald('Review'),
    t.bold(t.white('Teach')),
  ].join(` ${arrow} `);

  const verTag = `v${version}`;
  const mid1Pad = ' '.repeat(Math.max(1, 19 - verTag.length));
  const top = t.gray('╭──────────────────────────────────────────────────────────────────────╮');
  const mid1 = `${t.gray('│')}  ${t.bgCyan(' ◆ ADAPTIVE MASTERY ')} ${t.bold(t.white('Repository Learning System'))}${mid1Pad}${t.dim(verTag)}  ${t.gray('│')}`;
  const mid2 = `${t.gray('│')}  ${pipeline}    ${t.gray('│')}`;
  const bot = t.gray('╰──────────────────────────────────────────────────────────────────────╯');
  const lines = ['', top, mid1, mid2, bot];
  if (subtitle) lines.push(`${t.gray('│')}  ${subtitle}`);
  return lines.join('\n');
}

function actionBadge(t, action) {
  switch (action) {
    case 'created':
    case 'written':
    case 'written pointer skill':
      return t.emerald(`✦ ${action}`);
    case 'replaced':
    case 'updated':
      return t.brightCyan(`↻ ${action}`);
    case 'appended':
      return t.cyan(`＋ ${action}`);
    case 'unchanged':
      return t.gray(`• ${action}`);
    case 'removed':
      return t.amber(`－ ${action}`);
    default:
      return t.cyan(action);
  }
}

function progressBar(t, ratio, width = 20) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  const color = clamped >= 0.8 ? t.emerald : clamped >= 0.4 ? t.amber : t.rose;
  return `${color('█'.repeat(filled))}${t.gray('░'.repeat(empty))} ${t.bold(`${Math.round(clamped * 100)}%`)}`;
}

function createLogger({ quiet, json, noColor = false }) {
  const lines = [];
  const t = createTheme(isColorEnabled(noColor));
  return {
    lines,
    t,
    info(message) {
      if (!quiet && !json) process.stdout.write(`${message}\n`);
    },
    warn(message) {
      if (!json) process.stderr.write(`${t.amber('▲ warning:')} ${message}\n`);
      lines.push(`warning: ${message}`);
    },
    error(message) {
      process.stderr.write(`${t.rose('✖ error:')} ${message}\n`);
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

async function copyPayload({ target, sourceRoot, dryRun, log }) {
  const { t } = log;
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
      const raw = await readFile(src, 'utf8');
      if (!dryRun) {
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, raw, 'utf8');
      }
      files.push({ rel, sha256: sha256Normalized(raw) });
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  log.info(`${t.gray('│')}`);
  log.info(
    `${t.cyan('◆')}  ${t.bold('Immutable Kit')}  ${t.dim('──►')} ${t.brightCyan(`${toPosix(VENDOR_DIR)}/`)} ${t.gray(`(${files.length} files · SHA-256 locked)`)}`,
  );
  log.info(
    `${t.gray('│')}  ${t.gray('└─')} ${t.dim('SKILL.md · 5 role agents · 4 workflows · 4 templates · preflight CLI')}`,
  );
  return files;
}

async function pruneVendor({ target, files, dryRun, log }) {
  const { t } = log;
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
  if (removed) log.info(`${t.gray('│')}  ${t.amber(`✂ pruned ${removed} stale file(s)`)}`);
  return removed;
}

/**
 * Seed mutable user-owned config and learner profile in `docs/learning/` ONLY if absent.
 * Never overwritten by `update` (even `--force`) and never removed by `uninstall`.
 */
async function seedUserState({ target, sourceRoot, dryRun, log }) {
  const { t } = log;
  const learningDir = join(target, 'docs', 'learning');
  const localConfigPath = join(learningDir, 'config.local.yaml');
  const learnerProfilePath = join(learningDir, 'learner-profile.yaml');
  const gitignorePath = join(learningDir, '.gitignore');

  const seeded = [];
  const preserved = [];

  if (!(await exists(localConfigPath))) {
    if (!dryRun) {
      await mkdir(learningDir, { recursive: true });
      await writeFile(localConfigPath, LOCAL_CONFIG_SEED, 'utf8');
    }
    seeded.push(toPosix(relative(target, localConfigPath)));
  } else {
    preserved.push(toPosix(relative(target, localConfigPath)));
  }

  if (!(await exists(learnerProfilePath))) {
    const templateProfile = await readFile(join(sourceRoot, 'config', 'learner-profile.yaml'), 'utf8');
    const userCopy = templateProfile.replace(
      /^# Immutable seed template[^\n]*\n# Do NOT edit[^\n]*\n/,
      '# Active, mutable learner profile for this repository.\n# Updated from explicit learner feedback during lessons; survives kit updates.\n',
    );
    if (!dryRun) {
      await mkdir(learningDir, { recursive: true });
      await writeFile(learnerProfilePath, userCopy, 'utf8');
    }
    seeded.push(toPosix(relative(target, learnerProfilePath)));
  } else {
    preserved.push(toPosix(relative(target, learnerProfilePath)));
  }

  if (!(await exists(gitignorePath))) {
    if (!dryRun) {
      await mkdir(learningDir, { recursive: true });
      await writeFile(gitignorePath, LEARNING_GITIGNORE_SEED, 'utf8');
    }
    seeded.push(toPosix(relative(target, gitignorePath)));
  } else {
    preserved.push(toPosix(relative(target, gitignorePath)));
  }

  log.info(`${t.gray('│')}`);
  log.info(
    `${t.violet('◆')}  ${t.bold('Learner State')}  ${t.dim('──►')} ${t.violet('docs/learning/')} ${t.gray('(mutable · survives kit updates)')}`,
  );
  for (const rel of seeded) {
    log.info(`${t.gray('│')}  ${t.gray('├─')} ${actionBadge(t, 'created')}  ${t.white(rel)}`);
  }
  for (const rel of preserved) {
    log.info(`${t.gray('│')}  ${t.gray('├─')} ${t.cyan('🛡 preserved')} ${t.dim(rel)}`);
  }
  return seeded;
}

/* ----------------------------------------------------------------- block */

function renderTemplate(template, { version, dir }) {
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

function extractManagedBlock(text) {
  const m = blockPattern().exec(text);
  return m ? m[0] : null;
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function applyBlock({ file, block, dryRun, log, label, base }) {
  const { t } = log;
  const normalized = `${block.trimEnd()}\n`;
  const trimmed = normalized.trimEnd();
  const existsAlready = await exists(file);
  const current = existsAlready ? await readFile(file, 'utf8') : '';
  const pattern = blockPattern();
  const has = pattern.test(current);

  let next;
  let action;
  if (has) {
    next = current.replace(pattern, trimmed);
    action = next === current ? 'unchanged' : 'replaced';
  } else if (current.trim() === '') {
    next = normalized;
    action = 'created';
  } else {
    next = `${current.trimEnd()}\n\n${normalized}`;
    action = 'appended';
  }

  if (action !== 'unchanged' && !dryRun) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, next, 'utf8');
  }
  const shown = base ? toPosix(relative(base, file)) : toPosix(file);
  log.info(`${t.gray('│')}  ${t.gray('├─')} ${actionBadge(t, action)}  ${t.bold(label)} ${t.dim(`(${shown})`)}`);
  return { action, blockSha256: sha256Normalized(trimmed) };
}

async function stripBlock({ file, dryRun, log, label }) {
  const { t } = log;
  if (!(await exists(file))) return 'absent';
  const current = await readFile(file, 'utf8');
  const pattern = new RegExp(
    `\\n*${escapeRe(MARKER_BEGIN)}[^>]*-->[\\s\\S]*?${escapeRe(MARKER_END)}\\n*`,
    'm',
  );
  if (!pattern.test(current)) return 'absent';
  const next = current.replace(pattern, '\n').replace(/\n+$/, '').replace(/^\n+/, '');
  if (!dryRun) {
    if (!next.trim()) {
      // File only held the managed block: delete it rather than leaving a 0-byte orphan.
      await rm(file, { force: true });
    } else {
      await writeFile(file, `${next}\n`, 'utf8');
    }
  }
  log.info(
    `${t.gray('│')}  ${t.gray('├─')} ${actionBadge(t, 'removed')}  ${t.bold(label)} ${t.dim(!next.trim() ? '(deleted empty file)' : '(stripped managed block)')}`,
  );
  return 'removed';
}

/* -------------------------------------------------------------- adapters */

export async function detectHarnesses(target) {
  const found = new Set();
  for (const entry of HARNESS_REGISTRY) {
    for (const trigger of entry.detect) {
      if (await exists(join(target, trigger))) {
        found.add(entry.id);
        break;
      }
    }
  }
  if (found.size === 0) found.add('agents');
  return [...found].sort();
}

export function parseHarnesses(raw, customFile = null) {
  if (!raw && !customFile) return null;
  if (!raw && customFile) return ['custom'];
  const parts = raw
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.includes('all')) {
    const all = [...HARNESSES];
    if (customFile && !all.includes('custom')) all.push('custom');
    return all.sort();
  }
  const allowed = new Set([...HARNESSES, 'custom']);
  const invalid = parts.filter((p) => !allowed.has(p));
  if (invalid.length) {
    throw new Error(
      `unknown harness: ${invalid.join(', ')} (expected ${HARNESSES.join(', ')}, custom, or all)`,
    );
  }
  if (parts.includes('custom') && !customFile) {
    throw new Error('--harness custom requires --file <path>');
  }
  return [...new Set(parts)].sort();
}

async function writeAdapters({ target, harnesses, customFiles = [], version, dryRun, log }) {
  const { t } = log;
  const written = {};
  const adapterHashes = [];
  const fullBlock = renderTemplate(await readTemplate('block.md'), { version, dir: VENDOR_DIR });
  const claudePointerBlock = renderTemplate(await readTemplate('claude-pointer-block.md'), {
    version,
    dir: VENDOR_DIR,
  });

  log.info(`${t.gray('│')}`);
  log.info(`${t.emerald('◆')}  ${t.bold('Harness Adapters')}`);

  const agentsActive =
    harnesses.includes('agents') ||
    ((await exists(join(target, 'AGENTS.md'))) &&
      blockPattern().test(await readFile(join(target, 'AGENTS.md'), 'utf8')));

  for (const harnessId of harnesses) {
    if (harnessId === 'custom') continue;
    const spec = HARNESS_REGISTRY.find((h) => h.id === harnessId);
    if (!spec) continue;

    const { write } = spec;

    if (write.kind === 'block') {
      const absFile = join(target, write.file);
      const relFile = toPosix(write.file);
      const res = await applyBlock({
        file: absFile,
        block: fullBlock,
        dryRun,
        log,
        label: relFile,
        base: target,
      });
      written[harnessId] = res.action;
      adapterHashes.push({
        harness: harnessId,
        kind: 'block',
        file: relFile,
        sha256: res.blockSha256,
      });
    } else if (write.kind === 'file') {
      const absFile = join(target, write.file);
      const relFile = toPosix(write.file);
      const rendered = `${renderTemplate(await readTemplate(write.template), {
        version,
        dir: VENDOR_DIR,
      }).trimEnd()}\n`;
      if (!dryRun) {
        await mkdir(dirname(absFile), { recursive: true });
        await writeFile(absFile, rendered, 'utf8');
      }
      log.info(`${t.gray('│')}  ${t.gray('├─')} ${actionBadge(t, 'written')}  ${t.bold(relFile)}`);
      written[harnessId] = relFile;
      adapterHashes.push({
        harness: harnessId,
        kind: 'file',
        file: relFile,
        sha256: sha256Normalized(rendered),
      });
    } else if (write.kind === 'claude') {
      // 1. Write lightweight pointer skill stub (no duplicate copy of PAYLOAD)
      const skillAbs = join(target, write.skillFile);
      const skillRel = toPosix(write.skillFile);
      const skillContent = `${renderTemplate(await readTemplate(write.skillTemplate), {
        version,
        dir: VENDOR_DIR,
      }).trimEnd()}\n`;
      if (!dryRun) {
        // Remove any legacy vendored subdirectories inside .claude/skills/adaptive-mastery/
        const skillDir = dirname(skillAbs);
        if (await exists(skillDir)) {
          for (const entry of await readdir(skillDir, { withFileTypes: true })) {
            if (entry.isDirectory() || entry.name !== 'SKILL.md') {
              await rm(join(skillDir, entry.name), { recursive: true, force: true });
            }
          }
        }
        await mkdir(skillDir, { recursive: true });
        await writeFile(skillAbs, skillContent, 'utf8');
      }
      log.info(
        `${t.gray('│')}  ${t.gray('├─')} ${actionBadge(t, 'written pointer skill')}  ${t.bold(skillRel)}`,
      );
      adapterHashes.push({
        harness: 'claude',
        kind: 'file',
        file: skillRel,
        sha256: sha256Normalized(skillContent),
      });

      // 2. Write CLAUDE.md block: use pointer block if AGENTS.md is also active or imported
      const claudeAbs = join(target, write.file);
      const claudeRel = toPosix(write.file);
      const existingClaude = (await exists(claudeAbs)) ? await readFile(claudeAbs, 'utf8') : '';
      const importsAgents = /@AGENTS\.md\b/.test(existingClaude);
      const blockToUse = agentsActive || importsAgents ? claudePointerBlock : fullBlock;

      const res = await applyBlock({
        file: claudeAbs,
        block: blockToUse,
        dryRun,
        log,
        label: claudeRel,
        base: target,
      });
      written.claude = {
        skill: skillRel,
        claudeMd: res.action,
        mode: agentsActive || importsAgents ? 'pointer' : 'full',
      };
      adapterHashes.push({
        harness: 'claude',
        kind: 'block',
        file: claudeRel,
        sha256: res.blockSha256,
      });
    }
  }

  for (const customRel of customFiles) {
    const absFile = resolve(target, customRel);
    const relFile = toPosix(relative(target, absFile));
    const res = await applyBlock({
      file: absFile,
      block: fullBlock,
      dryRun,
      log,
      label: `custom (${relFile})`,
      base: target,
    });
    if (!written.custom) written.custom = {};
    written.custom[relFile] = res.action;
    adapterHashes.push({
      harness: 'custom',
      kind: 'block',
      file: relFile,
      sha256: res.blockSha256,
    });
  }

  return { written, adapterHashes };
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

async function writeManifest({
  target,
  version,
  harnesses,
  customFiles,
  files,
  adapters,
  adapterHashes,
  dryRun,
}) {
  const previous = await readManifest(target);
  const now = new Date().toISOString();
  const manifest = {
    schema: 2,
    package: 'adaptive-mastery',
    version,
    installed_at: previous?.installed_at ?? now,
    updated_at: now,
    harnesses,
    ...(customFiles.length ? { custom_files: customFiles } : {}),
    adapters,
    adapter_hashes: adapterHashes,
    files,
  };
  if (!dryRun) {
    await mkdir(join(target, VENDOR_DIR), { recursive: true });
    await writeFile(manifestPath(target), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
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

async function detectAdapterProblems({ target, manifest }) {
  const problems = [];
  const adapterHashes = manifest.adapter_hashes ?? [];

  if (adapterHashes.length > 0) {
    for (const entry of adapterHashes) {
      const abs = join(target, entry.file);
      if (!(await exists(abs))) {
        problems.push(`adapter file is missing: ${entry.file} (${entry.harness})`);
        continue;
      }
      const content = await readFile(abs, 'utf8');
      if (entry.kind === 'file') {
        if (sha256Normalized(content) !== entry.sha256) {
          problems.push(`adapter file modified: ${entry.file} (${entry.harness})`);
        }
      } else if (entry.kind === 'block') {
        const block = extractManagedBlock(content);
        if (!block) {
          problems.push(`${entry.file} is missing the managed block (${entry.harness})`);
        } else if (sha256Normalized(block) !== entry.sha256) {
          problems.push(`${entry.file} managed block was modified (${entry.harness})`);
        }
      }
    }
    return problems;
  }

  // Fallback for schema v1 manifests without adapter_hashes
  for (const harness of manifest.harnesses ?? []) {
    const spec = HARNESS_REGISTRY.find((h) => h.id === harness);
    if (!spec) continue;
    if (spec.write.kind === 'block') {
      const file = join(target, spec.write.file);
      const present = (await exists(file)) && blockPattern().test(await readFile(file, 'utf8'));
      if (!present) problems.push(`${spec.write.file} is missing the managed block`);
    } else if (spec.write.kind === 'file') {
      const file = join(target, spec.write.file);
      if (!(await exists(file))) problems.push(`${spec.write.file} is missing`);
    } else if (spec.write.kind === 'claude') {
      const skill = join(target, spec.write.skillFile);
      if (!(await exists(skill))) problems.push('Claude skill SKILL.md is missing');
    }
  }
  return problems;
}

async function install({
  target,
  harnesses: requested,
  customFile,
  dryRun,
  force,
  log,
  command,
}) {
  const { t } = log;
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

  // Union harnesses on update (or re-init when existing installation has harnesses) so
  // `update --harness cursor` after installing `claude` never orphans previously installed adapters.
  let harnesses;
  if (requested) {
    if (command === 'update' && existing?.harnesses) {
      harnesses = [...new Set([...existing.harnesses, ...requested])].sort();
    } else {
      harnesses = requested;
    }
  } else {
    harnesses = existing?.harnesses ?? (await detectHarnesses(target));
  }

  const prevCustom = existing?.custom_files ?? [];
  const customFiles = [
    ...new Set([
      ...prevCustom,
      ...(customFile ? [toPosix(relative(target, resolve(target, customFile)))] : []),
    ]),
  ].sort();

  const harnessPills = harnesses.map((h) => t.brightCyan(`[${h}]`)).join(' ');
  const modeBadge = dryRun ? ` ${t.bgAmber(' DRY RUN ')}` : '';
  log.info(renderBanner(t, version));
  log.info(
    `${t.brightCyan('┌')}  ${t.bold(command === 'update' ? 'Updating installation' : 'Initializing repository learning system')}${modeBadge}`,
  );
  log.info(`${t.gray('│')}  ${t.dim('target:')}    ${t.white(toPosix(target))}`);
  log.info(`${t.gray('│')}  ${t.dim('harnesses:')} ${harnessPills}`);

  const files = await copyPayload({ target, sourceRoot: PKG_ROOT, dryRun, log });
  await pruneVendor({ target, files, dryRun, log });
  await seedUserState({ target, sourceRoot: PKG_ROOT, dryRun, log });
  const { written: adapters, adapterHashes } = await writeAdapters({
    target,
    harnesses,
    customFiles,
    version,
    dryRun,
    log,
  });
  const manifest = await writeManifest({
    target,
    version,
    harnesses,
    customFiles,
    files,
    adapters,
    adapterHashes,
    dryRun,
  });

  const statusLine = dryRun
    ? `${t.amber('◆')}  ${t.bold(t.amber('Dry run complete'))} ${t.dim('— no files were written to disk.')}`
    : `${t.emerald('✔')}  ${t.bold(t.emerald(`Installed adaptive-mastery v${version}`))} ${t.dim(`(${toPosix(join(VENDOR_DIR, 'install.json'))})`)}`;

  log.summary(
    [
      `${t.gray('│')}`,
      `${t.brightCyan('└')}  ${statusLine}`,
      '',
      `   ${t.gray('╭─')} ${t.bold(t.brightCyan('Next step — paste into your AI agent'))} ${t.gray('─────────────────────────────╮')}`,
      `   ${t.gray('│')}                                                                     ${t.gray('│')}`,
      `   ${t.gray('│')}  ${t.emerald('❯')} ${t.bold(t.white('"Initialize the Adaptive Mastery System for this repository."'))}  ${t.gray('│')}`,
      `   ${t.gray('│')}                                                                     ${t.gray('│')}`,
      `   ${t.gray('│')}  ${t.dim('Health check:')} ${t.cyan('adaptive-mastery doctor')}                              ${t.gray('│')}`,
      `   ${t.gray('│')}  ${t.dim('Coverage:')}     ${t.cyan('adaptive-mastery validate')}                            ${t.gray('│')}`,
      `   ${t.gray('╰─────────────────────────────────────────────────────────────────────╯')}`,
      '',
    ].join('\n'),
  );
  return { code: 0, manifest };
}

async function doctor({ target, log, json }) {
  const { t } = log;
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

  const adapterProblems = await detectAdapterProblems({ target, manifest });
  problems.push(...adapterProblems);

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) problems.push(`Node ${process.versions.node} is older than the supported 18`);
  if (!manifest.harnesses || manifest.harnesses.length === 0) {
    problems.push('no harness recorded in the manifest');
  }

  if (json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: problems.length === 0,
          version: manifest.version,
          harnesses: manifest.harnesses,
          problems,
          notes,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    const harnessPills = (manifest.harnesses ?? []).map((h) => t.brightCyan(`[${h}]`)).join(' ') || t.dim('(none)');
    log.info(renderBanner(t, manifest.version));
    log.info(`${t.brightCyan('┌')}  ${t.bold('Installation Doctor')} ${t.dim('──►')} ${t.white(toPosix(target))}`);
    log.info(`${t.gray('│')}  ${t.dim('harnesses:')} ${harnessPills}`);
    log.info(
      `${t.gray('│')}  ${t.dim('kit files:')} ${t.white(manifest.files.length)} ${t.gray('(LF-normalized SHA-256 verified)')}`,
    );
    log.info(
      `${t.gray('│')}  ${t.dim('adapters:')}  ${t.white((manifest.adapter_hashes ?? []).length)} ${t.gray('tracked')}`,
    );
    for (const note of notes) log.info(`${t.gray('│')}  ${t.amber('ℹ')} ${note}`);
    if (problems.length === 0) {
      log.summary(`${t.brightCyan('└')}  ${t.emerald('✔')} ${t.bold(t.emerald('Installation is healthy.'))}\n`);
    } else {
      log.warn(`${problems.length} problem(s) found`);
      for (const problem of problems) log.error(problem);
    }
  }
  return problems.length === 0 ? 0 : 1;
}

async function uninstall({ target, dryRun, log }) {
  const { t } = log;
  const manifest = await readManifest(target);
  if (!manifest) {
    log.warn(`no installation found at ${toPosix(target)}; nothing to remove`);
    return 0;
  }

  log.info('');
  log.info(
    `${t.amber('┌')}  ${t.bold(`Uninstalling adaptive-mastery v${manifest.version}`)} ${t.dim('──►')} ${t.white(toPosix(target))}`,
  );

  const adapterHashes = manifest.adapter_hashes ?? [];
  if (adapterHashes.length > 0) {
    for (const entry of adapterHashes) {
      const abs = join(target, entry.file);
      if (entry.kind === 'block') {
        await stripBlock({ file: abs, dryRun, log, label: entry.file });
      } else if (entry.kind === 'file') {
        if (!dryRun) await rm(abs, { force: true });
        log.info(`${t.gray('│')}  ${t.gray('├─')} ${actionBadge(t, 'removed')}  ${t.bold(entry.file)}`);
        if (entry.harness === 'claude') {
          const skillDir = dirname(abs);
          if (!dryRun) await rm(skillDir, { recursive: true, force: true });
        }
      }
    }
  } else {
    // Fallback for schema v1 manifests
    for (const harness of manifest.harnesses ?? []) {
      const spec = HARNESS_REGISTRY.find((h) => h.id === harness);
      if (!spec) continue;
      if (spec.write.kind === 'block') {
        await stripBlock({
          file: join(target, spec.write.file),
          dryRun,
          log,
          label: spec.write.file,
        });
      } else if (spec.write.kind === 'file') {
        if (!dryRun) await rm(join(target, spec.write.file), { force: true });
        log.info(`${t.gray('│')}  ${t.gray('├─')} ${actionBadge(t, 'removed')}  ${t.bold(spec.write.file)}`);
      } else if (spec.write.kind === 'claude') {
        const skillDir = dirname(join(target, spec.write.skillFile));
        if (!dryRun) await rm(skillDir, { recursive: true, force: true });
        log.info(
          `${t.gray('│')}  ${t.gray('├─')} ${actionBadge(t, 'removed')}  ${t.bold(toPosix(relative(target, skillDir)))}/`,
        );
        await stripBlock({
          file: join(target, spec.write.file),
          dryRun,
          log,
          label: spec.write.file,
        });
      }
    }
  }

  if (!dryRun) await rm(join(target, VENDOR_DIR), { recursive: true, force: true });
  log.info(`${t.gray('│')}  ${t.gray('└─')} ${actionBadge(t, 'removed')}  ${t.bold(`${VENDOR_DIR}/`)}`);
  log.summary(
    `${t.amber('└')}  ${t.emerald('✔')} ${t.bold('Uninstalled.')} ${t.dim('Files outside the managed block (including docs/learning/) were left untouched.')}\n`,
  );
  return 0;
}

async function printBlock() {
  const { version } = await readPackage();
  const block = renderTemplate(await readTemplate('block.md'), { version, dir: VENDOR_DIR });
  process.stdout.write(`${block.trimEnd()}\n`);
  return 0;
}

async function bundleKit({ target, out, dryRun, log }) {
  const { t } = log;
  const { version } = await readPackage();
  const sections = [
    `# Adaptive Mastery System — Self-Contained Bundle (v${version})`,
    '',
    '> Generated by `adaptive-mastery bundle`. Use this single-file bundle in chat UIs, web agents, or environments without local kit installation.',
    '',
  ];

  const orderedFiles = [
    'SKILL.md',
    'CURRICULUM_FORMAT.md',
    ...(await walk(join(PKG_ROOT, 'agents'), PKG_ROOT)),
    ...(await walk(join(PKG_ROOT, 'workflows'), PKG_ROOT)),
    ...(await walk(join(PKG_ROOT, 'templates'), PKG_ROOT)),
    ...(await walk(join(PKG_ROOT, 'config'), PKG_ROOT)),
    ...(await walk(join(PKG_ROOT, 'references'), PKG_ROOT)),
  ];

  for (const rel of orderedFiles) {
    const abs = join(PKG_ROOT, rel);
    if (!(await exists(abs))) continue;
    const content = (await readFile(abs, 'utf8')).replace(/\r\n/g, '\n').trimEnd();
    sections.push(`---`);
    sections.push(`<!-- bundle-file: ${rel} -->`);
    sections.push(`## File: \`${rel}\``);
    sections.push('');
    if (rel.endsWith('.yaml') || rel.endsWith('.json')) {
      const lang = rel.endsWith('.json') ? 'json' : 'yaml';
      sections.push(`\`\`\`${lang}`);
      sections.push(content);
      sections.push('```');
    } else {
      sections.push(content);
    }
    sections.push('');
  }

  const bundleText = `${sections.join('\n').trimEnd()}\n`;
  if (out === '-') {
    process.stdout.write(bundleText);
    return 0;
  }

  const dest = resolve(target, out ?? 'ADAPTIVE_MASTERY.md');
  if (!dryRun) {
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, bundleText, 'utf8');
  }
  log.summary(
    dryRun
      ? `${t.amber('◆')} Dry run: would write bundle (${bundleText.length} bytes) -> ${t.brightCyan(toPosix(dest))}`
      : `${t.emerald('✔')} ${t.bold(`Bundled Adaptive Mastery System v${version}`)} ${t.dim('──►')} ${t.brightCyan(toPosix(dest))} ${t.gray(`(${orderedFiles.length} files, ${bundleText.length} bytes)`)}`,
  );
  return 0;
}

function runValidate({ target, json, log }) {
  const { t } = log;
  const res = validateRepositoryState({ repoRoot: target });
  if (json) {
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
  } else {
    const badge = (state) =>
      state === null
        ? t.gray('○ absent')
        : state
          ? t.emerald('✔ valid')
          : t.rose('✖ INVALID');

    log.info('');
    log.info(`${t.brightCyan('┌')}  ${t.bold('Learning Library & Coverage Validator')} ${t.dim('──►')} ${t.white(res.repo_root)}`);
    log.info(`${t.gray('│')}  ${t.gray('├─')} progress.json:         ${badge(res.progress_valid)}`);
    log.info(`${t.gray('│')}  ${t.gray('├─')} feature-register.yaml: ${badge(res.feature_register_valid)}`);
    if (res.coverage) {
      log.info(
        `${t.gray('│')}  ${t.gray('├─')} mechanical coverage:   ${progressBar(t, res.coverage.coverage_ratio)} ${t.dim(`(${res.coverage.cited_source_files}/${res.coverage.total_source_files} source files cited)`)}`,
      );
      if (res.coverage.uncited_files.length) {
        log.info(
          `${t.gray('│')}  ${t.gray('└─')} ${t.amber('uncited files:')}         ${t.dim(res.coverage.uncited_files.join(', '))}`,
        );
      }
    }
    for (const w of res.warnings) log.warn(w);
    if (res.problems.length === 0) {
      log.summary(`${t.brightCyan('└')}  ${t.emerald('✔')} ${t.bold(t.emerald('State validation passed.'))}\n`);
    } else {
      for (const p of res.problems) log.error(p);
    }
  }
  return res.ok ? 0 : 1;
}

/* ------------------------------------------------------------------- main */

function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    command: 'init',
    target: null,
    harness: null,
    file: null,
    out: null,
    dryRun: false,
    force: false,
    quiet: false,
    json: false,
    noColor: false,
    rawArgs: [],
  };

  const commands = [
    'init',
    'update',
    'doctor',
    'uninstall',
    'preflight',
    'validate',
    'print',
    'bundle',
    'version',
    'help',
  ];
  if (args.length && !args[0].startsWith('-')) {
    const command = args[0].toLowerCase();
    if (!commands.includes(command)) {
      throw new Error(`unknown command: ${args[0]}`);
    }
    options.command = command;
    args.shift();
  }

  if (options.command === 'preflight') {
    options.rawArgs = args;
    return options;
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const takeValue = (name) => {
      const value = args[++i];
      if (!value || (value.startsWith('--') && value !== '-')) {
        throw new Error(`${name} requires a value`);
      }
      return value;
    };
    if (arg === '--target') options.target = takeValue('--target');
    else if (arg.startsWith('--target=')) options.target = arg.slice('--target='.length);
    else if (arg === '--harness') options.harness = takeValue('--harness');
    else if (arg.startsWith('--harness=')) options.harness = arg.slice('--harness='.length);
    else if (arg === '--file') options.file = takeValue('--file');
    else if (arg.startsWith('--file=')) options.file = arg.slice('--file='.length);
    else if (arg === '--out') options.out = takeValue('--out');
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--quiet') options.quiet = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--no-color') options.noColor = true;
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

  if (options.command === 'preflight') {
    return preflightMain(['node', 'preflight-review.mjs', ...options.rawArgs]);
  }

  if (options.command === 'print') {
    return await printBlock();
  }

  const log = createLogger({ quiet: options.quiet, json: options.json, noColor: options.noColor });
  const target = resolveTarget(options.target);

  if (options.command === 'version') {
    const { name, version } = await readPackage();
    const manifest = await readManifest(target);
    process.stdout.write(
      `${name} ${version}\ninstalled: ${manifest ? manifest.version : 'not installed'}\n`,
    );
    return 0;
  }

  if (options.command === 'bundle') {
    return await bundleKit({ target, out: options.out, dryRun: options.dryRun, log });
  }

  if (options.command === 'validate') {
    return runValidate({ target, json: options.json, log });
  }

  try {
    const harnesses = parseHarnesses(options.harness, options.file);
    if (options.command === 'doctor') return await doctor({ target, log, json: options.json });
    if (options.command === 'uninstall') {
      return await uninstall({ target, dryRun: options.dryRun, log });
    }
    const result = await install({
      target,
      harnesses,
      customFile: options.file,
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
    const a = realpathSync(process.argv[1]);
    const b = realpathSync(thisFile);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    const a = resolve(process.argv[1]);
    const b = resolve(thisFile);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
}
