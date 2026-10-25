import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { analyzeGuide, extractReferences, slugify, REQUIRED_SECTIONS } from '../tools/preflight-review.mjs';

function fixture({ lessonRefs = 'See `src/app.ts`.', referenceRefs = '', evidence = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ams-preflight-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'app.ts'), 'export function handleUpload() {}\n');
  writeFileSync(join(dir, 'notes.md'), '# Overview\n\n## Details here\n');

  const sections = REQUIRED_SECTIONS.map((s) => {
    const title = s.replace(/\b\w/g, (c) => c.toUpperCase());
    return `## ${title}\n\nplaceholder\n`;
  });

  const body = [
    '# 001 — Upload',
    '',
    sections[0],
    lessonRefs,
    '',
    sections[1],
    sections[2],
    sections[3],
    sections[4],
    sections[5],
    sections[6],
    sections[7],
    referenceRefs,
    '',
    sections[8],
    evidence ? '| Claim | Evidence | Type | Confidence |\n|---|---|---|---|\n| rows | src/app.ts | code | high |' : '',
    '',
    sections[9],
  ].join('\n');

  const guide = join(dir, 'guide.md');
  writeFileSync(guide, body);
  return { dir, guide };
}

describe('slugify', () => {
  test('matches GitHub heading anchors', () => {
    assert.equal(slugify('What this helps the user do'), 'what-this-helps-the-user-do');
    assert.equal(slugify('Evidence and confidence'), 'evidence-and-confidence');
    assert.equal(slugify('Technical reference'), 'technical-reference');
  });
});

describe('reference extraction', () => {
  test('reads markdown links, inline paths and arrow forms', () => {
    const refs = extractReferences(
      ['See `src/app.ts` and `src/app.ts -> handleUpload()` plus [notes](notes.md#details-here).'],
      null,
    );
    const targets = refs.map((r) => r.target);
    assert.ok(targets.includes('src/app.ts'));
    assert.ok(targets.includes('notes.md'));
    assert.equal(refs.find((r) => r.target === 'notes.md').anchor, 'details-here');
  });

  test('ignores external URLs', () => {
    const refs = extractReferences(['[site](https://example.com/x) and [mail](mailto:a@b.c)'], null);
    assert.equal(refs.length, 0);
  });

  test('assigns the reference layer after the Technical reference heading', () => {
    const lines = ['## Lesson', '`src/app.ts`', '## Technical reference', '`src/app.ts`'];
    const refs = extractReferences(lines, 3);
    assert.equal(refs.filter((r) => r.layer === 'lesson').length, 1);
    assert.equal(refs.filter((r) => r.layer === 'reference').length, 1);
  });
});

describe('analyzeGuide', () => {
  test('accepts a clean guide', () => {
    const { dir, guide } = fixture();
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, false);
      assert.deepEqual(summary.sections.missing, []);
      assert.equal(summary.references.resolved_lesson, 1);
      assert.equal(summary.evidence_rows, 1);
      assert.ok(summary.layer_split_line > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports a missing path', () => {
    const { dir, guide } = fixture({ referenceRefs: '`src/missing.ts`' });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.equal(summary.references.missing.length, 1);
      assert.equal(summary.references.missing[0].target, 'src/missing.ts');
      assert.equal(summary.references.missing[0].layer, 'reference');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports a broken same-document anchor', () => {
    const { dir, guide } = fixture({ lessonRefs: '[x](#not-a-heading)' });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.equal(summary.references.broken_anchors.length, 1);
      assert.match(summary.references.broken_anchors[0].reason, /no matching heading/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports a broken cross-document anchor', () => {
    const { dir, guide } = fixture({ lessonRefs: '[x](notes.md#nope)' });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.equal(summary.references.broken_anchors.length, 1);
      assert.match(summary.references.broken_anchors[0].reason, /heading not found in notes\.md/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts a valid cross-document anchor', () => {
    const { dir, guide } = fixture({ lessonRefs: '[x](notes.md#details-here)' });
    try {
      const { blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports missing required sections', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ams-sections-'));
    try {
      const guide = join(dir, 'guide.md');
      writeFileSync(guide, '# Only a title\n\n## What this helps the user do\n\ntext\n');
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.ok(summary.sections.missing.includes('technical reference'));
      assert.ok(summary.sections.missing.length >= 5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws for a missing guide', () => {
    assert.throws(() => analyzeGuide({ guidePath: join(tmpdir(), 'nope-xyz.md') }), /guide not found/);
  });
});

describe('gate arithmetic', () => {
  function withReport(scores, dir) {
    writeFileSync(join(dir, 'notes.md'), '# Overview\n\n## Details here\n');
    const rows = scores
      .map((score, index) => `| ${index + 1}. Criterion ${index + 1} | ${score} | because |`)
      .join('\n');
    const report = join(dir, 'r.review.md');
    writeFileSync(report, `# Review\n\n| Criterion | Score (0–4) | Evidence |\n|---|---:|---|\n${rows}\n`);
    return report;
  }

  test('passes a guide that meets every threshold', () => {
    const { dir, guide } = fixture();
    try {
      const report = withReport([4, 3, 3, 3, 3, 3, 3, 3, 3, 3], dir);
      const { summary } = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: report });
      assert.equal(summary.gate.passes, true);
      assert.equal(summary.gate.average, 3.1);
      assert.deepEqual(summary.gate.reasons, []);
      assert.equal(summary.gate.scores.length, 10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails a hard criterion below 3 even when the average is fine', () => {
    const { dir, guide } = fixture();
    try {
      const report = withReport([4, 2, 4, 4, 4, 4, 4, 4, 4, 4], dir);
      const { summary } = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: report });
      assert.equal(summary.gate.passes, false);
      assert.equal(summary.gate.average, 3.8);
      assert.ok(summary.gate.reasons.some((r) => r.includes('criterion 2 scored 2')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails a soft criterion below 2', () => {
    const { dir, guide } = fixture();
    try {
      const report = withReport([4, 3, 3, 3, 3, 1, 3, 3, 3, 3], dir);
      const { summary } = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: report });
      assert.equal(summary.gate.passes, false);
      assert.ok(summary.gate.reasons.some((r) => r.includes('criterion 6 scored 1')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails an incomplete scorecard', () => {
    const { dir, guide } = fixture();
    try {
      const report = withReport([4, 3, 3], dir);
      const { summary } = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: report });
      assert.equal(summary.gate.scores_complete, false);
      assert.ok(summary.gate.reasons.some((r) => r.includes('incomplete')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
