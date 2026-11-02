import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAYLOAD } from '../install/cli.mjs';
import { loadMasteryConfig } from '../tools/preflight-review.mjs';

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

  test('PAYLOAD includes CURRICULUM_FORMAT.md and excludes docs/RELEASING.md', () => {
    const pkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'));
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

  test('review thresholds in config/mastery-system.yaml match reviewer and workflow docs', () => {
    const config = loadMasteryConfig(PKG_ROOT);
    assert.equal(config.review.minimum_accuracy_score, 3);
    assert.equal(config.review.minimum_purpose_score, 3);
    assert.equal(config.review.minimum_prerequisite_score, 3);
    assert.equal(config.review.minimum_conceptual_load_score, 3);
    assert.equal(config.review.minimum_cause_effect_score, 3);
    assert.equal(config.review.minimum_other_criterion_score, 2);
    assert.equal(config.review.minimum_average, 3.0);
    assert.equal(config.review.max_full_reference_reads_per_pass, 12);
    assert.equal(config.review.max_extra_source_inspections_per_pass, 5);
    assert.equal(config.review.reference_spot_checks, 3);
    assert.equal(config.review.max_blocking_findings, 5);

    const reviewerDoc = readFileSync(join(PKG_ROOT, 'agents', '04-independent-reviewer.md'), 'utf8');
    const workflowDoc = readFileSync(
      join(PKG_ROOT, 'workflows', '04-independent-review-loop.md'),
      'utf8',
    );

    assert.match(
      reviewerDoc,
      new RegExp(`max_full_reference_reads_per_pass\\\` \\(${config.review.max_full_reference_reads_per_pass}\\)`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`max_extra_source_inspections_per_pass\\\` \\(${config.review.max_extra_source_inspections_per_pass}\\)`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`max_blocking_findings\\\` \\(${config.review.max_blocking_findings}\\)`),
    );
    assert.match(
      reviewerDoc,
      new RegExp(`reference_spot_checks\\\` \\(${config.review.reference_spot_checks}\\)`),
    );
    assert.match(
      workflowDoc,
      new RegExp(`\\| Full reference reads per pass \\| ${config.review.max_full_reference_reads_per_pass} \\|`),
    );
  });
});
