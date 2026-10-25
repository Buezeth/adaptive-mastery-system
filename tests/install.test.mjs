import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main } from '../install/cli.mjs';

const PKG_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const VENDOR = '.adaptive-mastery';

function makeProject() {
  return mkdtempSync(join(tmpdir(), 'ams-install-'));
}

function run(args) {
  return main(['node', 'cli.mjs', ...args]);
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, VENDOR, 'install.json'), 'utf8'));
}

function blockCount(file) {
  const text = readFileSync(file, 'utf8');
  return (text.match(/<!-- adaptive-mastery:begin/g) ?? []).length;
}

describe('init', () => {
  let dir;
  before(() => {
    dir = makeProject();
    writeFileSync(join(dir, 'AGENTS.md'), '# Existing project rules\n\nKeep me.\n');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('vendors the kit and records a manifest', async () => {
    const code = await run(['init', '--target', dir, '--harness', 'agents', '--quiet']);
    assert.equal(code, 0);
    assert.ok(existsSync(join(dir, VENDOR, 'SKILL.md')));
    assert.ok(existsSync(join(dir, VENDOR, 'agents', '04-independent-reviewer.md')));
    assert.ok(existsSync(join(dir, VENDOR, 'tools', 'preflight-review.mjs')));

    const manifest = readManifest(dir);
    assert.equal(manifest.version, JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version);
    assert.deepEqual(manifest.harnesses, ['agents']);
    assert.ok(manifest.files.length > 10);
    assert.equal(manifest.installed_at, manifest.updated_at);
  });

  test('injects a managed block and preserves existing content', async () => {
    const text = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(text, /Keep me\./);
    assert.equal(blockCount(join(dir, 'AGENTS.md')), 1);
    assert.match(text, /\.adaptive-mastery\/SKILL\.md/);
  });

  test('is idempotent', async () => {
    const first = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    const code = await run(['init', '--target', dir, '--harness', 'agents', '--quiet']);
    assert.equal(code, 0);
    assert.equal(blockCount(join(dir, 'AGENTS.md')), 1);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), first);
  });
});

describe('harnesses', () => {
  test('claude writes a self-contained skill and CLAUDE.md', async () => {
    const dir = makeProject();
    try {
      const code = await run(['init', '--target', dir, '--harness', 'claude', '--quiet']);
      assert.equal(code, 0);
      const skill = join(dir, '.claude', 'skills', 'adaptive-mastery', 'SKILL.md');
      assert.ok(existsSync(skill));
      // Siblings must sit beside SKILL.md for the skill to resolve them.
      assert.ok(existsSync(join(dir, '.claude', 'skills', 'adaptive-mastery', 'agents', '00-orchestrator.md')));
      assert.equal(blockCount(join(dir, 'CLAUDE.md')), 1);
      assert.ok(!existsSync(join(dir, 'AGENTS.md')), 'must not touch AGENTS.md for a claude-only install');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('cursor writes a rule file', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'cursor', '--quiet']), 0);
      const rule = join(dir, '.cursor', 'rules', 'adaptive-mastery.mdc');
      assert.ok(existsSync(rule));
      assert.match(readFileSync(rule, 'utf8'), /alwaysApply: false/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('all writes every adapter', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'all', '--quiet']), 0);
      assert.ok(existsSync(join(dir, 'AGENTS.md')));
      assert.ok(existsSync(join(dir, 'CLAUDE.md')));
      assert.ok(existsSync(join(dir, '.cursor', 'rules', 'adaptive-mastery.mdc')));
      assert.equal(blockCount(join(dir, 'AGENTS.md')), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects an unknown harness', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'notepad', '--quiet']), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('dry run', () => {
  test('writes nothing', async () => {
    const dir = makeProject();
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# Untouched\n');
      assert.equal(await run(['init', '--target', dir, '--harness', 'agents', '--dry-run', '--quiet']), 0);
      assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), '# Untouched\n');
      assert.ok(!existsSync(join(dir, VENDOR)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('update', () => {
  test('refuses to overwrite locally modified vendored files', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'agents', '--quiet']), 0);
      writeFileSync(join(dir, VENDOR, 'SKILL.md'), 'local edit');
      assert.equal(await run(['update', '--target', dir, '--quiet']), 1);
      assert.equal(readFileSync(join(dir, VENDOR, 'SKILL.md'), 'utf8'), 'local edit');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('restores files with --force and keeps the block single', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'agents', '--quiet']), 0);
      writeFileSync(join(dir, VENDOR, 'SKILL.md'), 'local edit');
      assert.equal(await run(['update', '--target', dir, '--force', '--quiet']), 0);
      assert.match(readFileSync(join(dir, VENDOR, 'SKILL.md'), 'utf8'), /Adaptive Mastery System/);
      assert.equal(blockCount(join(dir, 'AGENTS.md')), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails when nothing is installed', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['update', '--target', dir, '--quiet']), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('doctor', () => {
  test('reports a healthy install', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'agents', '--quiet']), 0);
      assert.equal(await run(['doctor', '--target', dir, '--quiet']), 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('detects a tampered vendored file', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'agents', '--quiet']), 0);
      writeFileSync(join(dir, VENDOR, 'SKILL.md'), 'tampered');
      assert.equal(await run(['doctor', '--target', dir, '--quiet']), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('detects a missing block', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'agents', '--quiet']), 0);
      writeFileSync(join(dir, 'AGENTS.md'), '# gone\n');
      assert.equal(await run(['doctor', '--target', dir, '--quiet']), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails when not installed', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['doctor', '--target', dir, '--quiet']), 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('uninstall', () => {
  test('removes managed artifacts and keeps user content', async () => {
    const dir = makeProject();
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# Mine\n\nRules here.\n');
      assert.equal(await run(['init', '--target', dir, '--harness', 'all', '--quiet']), 0);
      assert.equal(await run(['uninstall', '--target', dir, '--quiet']), 0);

      assert.ok(!existsSync(join(dir, VENDOR)));
      assert.ok(!existsSync(join(dir, '.claude', 'skills', 'adaptive-mastery')));
      assert.ok(!existsSync(join(dir, '.cursor', 'rules', 'adaptive-mastery.mdc')));

      const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
      assert.match(agents, /# Mine/);
      assert.equal(blockCount(join(dir, 'AGENTS.md')), 0);
      assert.ok(!/adaptive-mastery:begin/.test(agents));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('safety', () => {
  test('refuses to install into the kit repository itself', async () => {
    assert.equal(await run(['init', '--target', PKG_ROOT, '--quiet']), 1);
    assert.deepEqual(readdirSync(join(PKG_ROOT, 'agents')).length > 0, true);
  });

  test('rejects a target that does not exist', async () => {
    const missing = join(tmpdir(), `ams-does-not-exist-${Date.now()}`);
    assert.equal(await run(['init', '--target', missing, '--quiet']), 1);
  });

  test('rejects unknown options', async () => {
    assert.equal(await run(['init', '--nope']), 2);
  });

  test('rejects a flag missing its value', async () => {
    assert.equal(await run(['init', '--target']), 2);
  });
});
