import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main, HARNESS_REGISTRY } from '../install/cli.mjs';

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

describe('init and kit/state split', () => {
  let dir;
  before(() => {
    dir = makeProject();
    writeFileSync(join(dir, 'AGENTS.md'), '# Existing project rules\n\nKeep me.\n');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test('vendors the immutable kit, excludes RELEASING.md, includes CURRICULUM_FORMAT.md, and seeds docs/learning state', async () => {
    const code = await run(['init', '--target', dir, '--harness', 'agents', '--quiet']);
    assert.equal(code, 0);
    assert.ok(existsSync(join(dir, VENDOR, 'SKILL.md')));
    assert.ok(existsSync(join(dir, VENDOR, 'CURRICULUM_FORMAT.md')));
    assert.ok(existsSync(join(dir, VENDOR, 'agents', '04-independent-reviewer.md')));
    assert.ok(existsSync(join(dir, VENDOR, 'tools', 'preflight-review.mjs')));
    assert.ok(!existsSync(join(dir, VENDOR, 'docs', 'RELEASING.md')), 'must not vendor maintainer RELEASING.md');

    // Mutable user state is seeded in docs/learning/ outside .adaptive-mastery/
    assert.ok(existsSync(join(dir, 'docs', 'learning', 'config.local.yaml')));
    assert.ok(existsSync(join(dir, 'docs', 'learning', 'learner-profile.yaml')));
    assert.ok(existsSync(join(dir, 'docs', 'learning', '.gitignore')));
    assert.match(readFileSync(join(dir, 'docs', 'learning', '.gitignore'), 'utf8'), /progress\.json/);

    const manifest = readManifest(dir);
    assert.equal(manifest.version, JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version);
    assert.deepEqual(manifest.harnesses, ['agents']);
    assert.ok(manifest.files.length > 10);
    assert.ok(Array.isArray(manifest.adapter_hashes) && manifest.adapter_hashes.length === 1);
    assert.equal(manifest.installed_at, manifest.updated_at);
  });

  test('injects a managed block and preserves existing content', async () => {
    const text = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    assert.match(text, /Keep me\./);
    assert.equal(blockCount(join(dir, 'AGENTS.md')), 1);
    assert.match(text, /\.adaptive-mastery\/SKILL\.md/);
  });

  test('is idempotent and preserves learner-profile edits across update --force', async () => {
    const first = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
    const profilePath = join(dir, 'docs', 'learning', 'learner-profile.yaml');
    writeFileSync(profilePath, '# Custom learner state\nlearner:\n  known_concepts: ["http"]\n');

    // Editing docs/learning/learner-profile.yaml keeps doctor happy
    assert.equal(await run(['doctor', '--target', dir, '--quiet']), 0);

    // Updating (even with --force) preserves user state in docs/learning/
    assert.equal(await run(['update', '--target', dir, '--force', '--quiet']), 0);
    assert.match(readFileSync(profilePath, 'utf8'), /Custom learner state/);
    assert.equal(blockCount(join(dir, 'AGENTS.md')), 1);
    assert.equal(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), first);
  });
});

describe('registry harnesses', () => {
  for (const spec of HARNESS_REGISTRY) {
    test(`auto-detects and installs harness "${spec.id}" from registry`, async () => {
      const dir = makeProject();
      try {
        const trigger = spec.detect[0];
        const triggerPath = join(dir, trigger);
        if (trigger.endsWith('.md') || trigger.endsWith('.yml') || trigger.endsWith('.windsurfrules')) {
          mkdirSync( resolve(triggerPath, '..'), { recursive: true });
          writeFileSync(triggerPath, '');
        } else {
          mkdirSync(triggerPath, { recursive: true });
        }

        assert.equal(await run(['init', '--target', dir, '--harness', spec.id, '--quiet']), 0);
        const targetFile = join(dir, spec.write.file);
        assert.ok(existsSync(targetFile), `expected ${spec.write.file} to exist`);
        if (spec.write.skillFile) {
          assert.ok(existsSync(join(dir, spec.write.skillFile)));
          // Pointer stub only: must not duplicate the agents/ folder inside .claude/skills/
          assert.ok(!existsSync(join(dir, '.claude', 'skills', 'adaptive-mastery', 'agents')));
        }
        assert.equal(await run(['doctor', '--target', dir, '--quiet']), 0);
        assert.equal(await run(['uninstall', '--target', dir, '--quiet']), 0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test('all writes every adapter and uses a pointer block in CLAUDE.md so instructions are not duplicated', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'all', '--quiet']), 0);
      assert.ok(existsSync(join(dir, 'AGENTS.md')));
      assert.ok(existsSync(join(dir, 'CLAUDE.md')));
      assert.ok(existsSync(join(dir, '.cursor', 'rules', 'adaptive-mastery.mdc')));
      assert.equal(blockCount(join(dir, 'AGENTS.md')), 1);
      assert.equal(blockCount(join(dir, 'CLAUDE.md')), 1);

      const agentsText = readFileSync(join(dir, 'AGENTS.md'), 'utf8');
      const claudeText = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
      assert.match(claudeText, /@AGENTS\.md/);
      assert.ok(claudeText.length < agentsText.length, 'CLAUDE.md should use the short pointer block when AGENTS.md is active');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('custom harness writes to any specified --file and tracks it', async () => {
    const dir = makeProject();
    try {
      assert.equal(
        await run(['init', '--target', dir, '--harness', 'custom', '--file', '.custom/RULES.md', '--quiet']),
        0,
      );
      const customPath = join(dir, '.custom', 'RULES.md');
      assert.ok(existsSync(customPath));
      assert.equal(blockCount(customPath), 1);
      assert.equal(await run(['doctor', '--target', dir, '--quiet']), 0);
      assert.equal(await run(['uninstall', '--target', dir, '--quiet']), 0);
      assert.ok(!existsSync(customPath), '0-byte created custom file should be removed on uninstall');
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

describe('universal fallbacks (print, bundle, preflight subcommand)', () => {
  test('bundle produces a self-contained ADAPTIVE_MASTERY.md', async () => {
    const dir = makeProject();
    try {
      const outPath = join(dir, 'ADAPTIVE_MASTERY.md');
      assert.equal(await run(['bundle', '--target', dir, '--out', outPath, '--quiet']), 0);
      assert.ok(existsSync(outPath));
      const content = readFileSync(outPath, 'utf8');
      assert.match(content, /SKILL\.md/);
      assert.match(content, /CURRICULUM_FORMAT\.md/);
      assert.match(content, /agents\/04-independent-reviewer\.md/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('preflight subcommand runs on templates/feature-guide-template.md', async () => {
    const code = await run(['preflight', join(PKG_ROOT, 'templates', 'feature-guide-template.md')]);
    assert.equal(code, 0);
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

describe('update, CRLF normalization, and harness union', () => {
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

  test('unions harnesses on update --harness so prior adapters are not orphaned', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'claude', '--quiet']), 0);
      assert.equal(await run(['update', '--target', dir, '--harness', 'cursor', '--quiet']), 0);
      const manifest = readManifest(dir);
      assert.deepEqual(manifest.harnesses, ['claude', 'cursor']);

      assert.equal(await run(['uninstall', '--target', dir, '--quiet']), 0);
      assert.ok(!existsSync(join(dir, '.claude', 'skills', 'adaptive-mastery')));
      assert.ok(!existsSync(join(dir, 'CLAUDE.md')));
      assert.ok(!existsSync(join(dir, '.cursor', 'rules', 'adaptive-mastery.mdc')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('tolerates CRLF line-ending conversion without reporting false drift', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'agents,cursor', '--quiet']), 0);
      const skillPath = join(dir, VENDOR, 'SKILL.md');
      const rulePath = join(dir, '.cursor', 'rules', 'adaptive-mastery.mdc');
      writeFileSync(skillPath, readFileSync(skillPath, 'utf8').replace(/\r?\n/g, '\r\n'));
      writeFileSync(rulePath, readFileSync(rulePath, 'utf8').replace(/\r?\n/g, '\r\n'));

      assert.equal(await run(['doctor', '--target', dir, '--quiet']), 0);
      assert.equal(await run(['update', '--target', dir, '--quiet']), 0);
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
      assert.equal(await run(['init', '--target', dir, '--harness', 'agents,claude', '--quiet']), 0);
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

  test('detects a tampered Claude skill stub', async () => {
    const dir = makeProject();
    try {
      assert.equal(await run(['init', '--target', dir, '--harness', 'claude', '--quiet']), 0);
      writeFileSync(join(dir, '.claude', 'skills', 'adaptive-mastery', 'SKILL.md'), 'tampered skill');
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
  test('removes managed artifacts, deletes 0-byte created files, and keeps user content', async () => {
    const dir = makeProject();
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# Mine\n\nRules here.\n');
      assert.equal(await run(['init', '--target', dir, '--harness', 'agents,claude,cursor', '--quiet']), 0);
      assert.ok(existsSync(join(dir, 'CLAUDE.md')));
      assert.equal(await run(['uninstall', '--target', dir, '--quiet']), 0);

      assert.ok(!existsSync(join(dir, VENDOR)));
      assert.ok(!existsSync(join(dir, '.claude', 'skills', 'adaptive-mastery')));
      assert.ok(!existsSync(join(dir, '.cursor', 'rules', 'adaptive-mastery.mdc')));
      // CLAUDE.md was created by the installer with only the managed block, so it must be deleted, not left 0-byte
      assert.ok(!existsSync(join(dir, 'CLAUDE.md')), 'must not leave a 0-byte CLAUDE.md');

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
