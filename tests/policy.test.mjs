import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAYLOAD } from '../install/cli.mjs';
import {
  extractReferences,
  headingSlugs,
  loadMasteryConfig,
  resolveTarget,
  slugify,
} from '../tools/preflight-review.mjs';

const PKG_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function walkDocs(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'tests', '.smoke'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDocs(full));
    else if (entry.isFile() && /\.(md|mdc|yaml|yml|json)$/i.test(entry.name)) {
      if (entry.name === 'CHANGELOG.md') continue;
      out.push(full);
    }
  }
  return out;
}

describe('policy drift and hygiene guards', () => {
  test('no shipped documentation or config references .ps1 scripts', () => {
    const files = walkDocs(PKG_ROOT);
    const offenders = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (/\.ps1\b/i.test(content)) {
        offenders.push(relative(PKG_ROOT, file).split(sep).join('/'));
      }
    }
    assert.deepEqual(offenders, [], `Forbidden .ps1 references found in: ${offenders.join(', ')}`);
    assert.ok(!existsSync(join(PKG_ROOT, 'tools', 'preflight-review.ps1')));
  });

  test('every PAYLOAD and package.json files entry exists on disk, includes CURRICULUM_FORMAT.md, and excludes docs/RELEASING.md', () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
    for (const entry of PAYLOAD) {
      assert.ok(
        existsSync(join(PKG_ROOT, entry)),
        `PAYLOAD entry "${entry}" does not exist on disk`,
      );
    }
    for (const entry of pkg.files) {
      assert.ok(
        existsSync(join(PKG_ROOT, entry)),
        `package.json files entry "${entry}" does not exist on disk`,
      );
    }
    assert.ok(PAYLOAD.includes('CURRICULUM_FORMAT.md'));
    assert.ok(!PAYLOAD.includes('docs'));
    assert.ok(pkg.files.includes('CURRICULUM_FORMAT.md'));
    assert.ok(!pkg.files.includes('docs/'));
  });

  test('references/Adaptive_Mastery_Coach_SKILL.md has no skill frontmatter and is linked', () => {
    const coachText = readFileSync(
      join(PKG_ROOT, 'references', 'Adaptive_Mastery_Coach_SKILL.md'),
      'utf8',
    );
    assert.ok(!coachText.startsWith('---'), 'must not start with YAML skill frontmatter');
    const skillText = readFileSync(join(PKG_ROOT, 'SKILL.md'), 'utf8');
    assert.match(skillText, /references\/Adaptive_Mastery_Coach_SKILL\.md/);
    assert.match(skillText, /CURRICULUM_FORMAT\.md/);
  });

  test('review thresholds, gate scores (3/2/3.0), severity weights (3/2/1), and budgets match across config and prose docs', () => {
    const config = loadMasteryConfig(PKG_ROOT);
    const r = config.review;

    const reviewerDoc = readFileSync(join(PKG_ROOT, 'agents', '04-independent-reviewer.md'), 'utf8');
    const workflowDoc = readFileSync(
      join(PKG_ROOT, 'workflows', '04-independent-review-loop.md'),
      'utf8',
    );
    const checklistDoc = readFileSync(
      join(PKG_ROOT, 'references', 'manual-preflight-checklist.md'),
      'utf8',
    );
    const skillDoc = readFileSync(join(PKG_ROOT, 'SKILL.md'), 'utf8');
    const agentsDoc = readFileSync(join(PKG_ROOT, 'AGENTS.md'), 'utf8');
    const orchestratorDoc = readFileSync(join(PKG_ROOT, 'agents', '00-orchestrator.md'), 'utf8');

    // Verify 3 / 2 / 3.0 gate thresholds in reviewerDoc and checklistDoc against config
    assert.match(
      reviewerDoc,
      new RegExp(`minimum_accuracy_score:\\s*${r.minimum_accuracy_score}`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`minimum_purpose_score:\\s*${r.minimum_purpose_score}`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`minimum_prerequisite_score:\\s*${r.minimum_prerequisite_score}`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`minimum_conceptual_load_score:\\s*${r.minimum_conceptual_load_score}`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`minimum_cause_effect_score:\\s*${r.minimum_cause_effect_score}`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`minimum_other_criterion_score:\\s*${r.minimum_other_criterion_score}`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`minimum_average:\\s*${r.minimum_average.toFixed(1)}`),
    );

    assert.match(
      checklistDoc,
      new RegExp(`Criteria 1, 2, 3, 4, 5 must each be \`>= ${r.minimum_accuracy_score}\``),
    );
    assert.match(
      checklistDoc,
      new RegExp(`Criteria 6, 7, 8, 9, 10 must each be \`>= ${r.minimum_other_criterion_score}\``),
    );
    assert.match(
      checklistDoc,
      new RegExp(`arithmetic mean of all 10 scores must be \`>= ${r.minimum_average.toFixed(1)}\``),
    );

    // Verify severity weights (critical=3, major/blocking=2, minor/non-blocking=1) across policy files
    for (const [name, doc] of [
      ['SKILL.md', skillDoc],
      ['AGENTS.md', agentsDoc],
      ['agents/00-orchestrator.md', orchestratorDoc],
      ['agents/04-independent-reviewer.md', reviewerDoc],
      ['workflows/04-independent-review-loop.md', workflowDoc],
      ['references/manual-preflight-checklist.md', checklistDoc],
    ]) {
      assert.match(
        doc,
        /critical=3.*major\/blocking=2.*minor\/non-blocking=1/,
        `Severity weight formula drifted in ${name}`,
      );
    }

    // Verify budgets in reviewerDoc and workflowDoc
    assert.match(
      reviewerDoc,
      new RegExp(`max_full_reference_reads_per_pass\\\` \\(${r.max_full_reference_reads_per_pass}\\)`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`max_extra_source_inspections_per_pass\\\` \\(${r.max_extra_source_inspections_per_pass}\\)`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`max_blocking_findings\\\` \\(${r.max_blocking_findings}\\)`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`reference_spot_checks\\\` \\(${r.reference_spot_checks}\\)`),
    );
    assert.match(
      workflowDoc,
      new RegExp(`\\| Full reference reads per pass \\| ${r.max_full_reference_reads_per_pass} \\|`),
    );
    assert.match(
      workflowDoc,
      new RegExp(`\\| Extra source inspections per pass \\| ${r.max_extra_source_inspections_per_pass} \\|`),
    );
    assert.match(
      workflowDoc,
      new RegExp(`\\| Reference-layer spot checks \\| ${r.reference_spot_checks} \\|`),
    );
    assert.match(
      workflowDoc,
      new RegExp(`\\| Blocking findings per report \\| ${r.max_blocking_findings} \\|`),
    );
  });

  test('all kit markdown references to kit files and anchors resolve cleanly', () => {
    const mdFiles = walkDocs(PKG_ROOT).filter((f) => f.endsWith('.md'));
    // Illustrative or runtime-generated target paths in docs that are not static kit files
    const illustrativePattern =
      /^(?:\.\.\/|\/)*(?:(?:\.adaptive-mastery|docs\/learning|source-maps|features|reviews|path\/to|some\/file\.ts|relative\/path|lib\/engine|src\/app\.ts|\.cursor|\.claude|\.windsurf|\.clinerules|\.gemini|\.my-agent)\b.*|(?:ADAPTIVE_MASTERY\.md|CLAUDE\.md|GEMINI\.md|CONVENTIONS\.md|RULES\.md|\.github\/copilot-instructions\.md|\.aider\.conf\.yml|\.npmrc|progress\.json|learner-profile\.yaml|feature-register\.yaml|config\.local\.yaml|CURRICULUM\.md|001-upload\.md|install\.json|Makefile|src\/|target))$/;

    const broken = [];
    for (const file of mdFiles) {
      const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
      const refs = extractReferences(lines, null);
      const docSlugs = headingSlugs(lines);
      const relFile = relative(PKG_ROOT, file).split(sep).join('/');

      for (const ref of refs) {
        if (!ref.target) {
          if (ref.anchor && !docSlugs.has(slugify(ref.anchor))) {
            broken.push(`${relFile}:${ref.line} broken same-doc anchor #${ref.anchor}`);
          }
          continue;
        }
        const cleanTarget = ref.target.replace(/^@/, '');
        if (illustrativePattern.test(cleanTarget)) continue;
        if (cleanTarget.includes('<') || cleanTarget.includes('>') || cleanTarget.includes('*')) continue;

        const resolved = resolveTarget(cleanTarget, dirname(file), PKG_ROOT, ref.syntax);
        if (!resolved) {
          broken.push(`${relFile}:${ref.line} dead reference "${ref.raw}"`);
          continue;
        }
        if (!resolved.isDirectory && ref.anchor && resolved.path.endsWith('.md')) {
          const targetSlugs = headingSlugs(
            readFileSync(resolved.path, 'utf8').replace(/\r\n/g, '\n').split('\n'),
          );
          if (!targetSlugs.has(slugify(ref.anchor))) {
            broken.push(`${relFile}:${ref.line} dead anchor "${ref.raw}"`);
          }
        }
      }
    }

    assert.deepEqual(broken, [], `Dead references or anchors in kit docs:\n${broken.join('\n')}`);
  });
});
