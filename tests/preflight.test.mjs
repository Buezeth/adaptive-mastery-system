import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyzeGuide,
  extractReferences,
  headingSlugs,
  slugify,
  validateRepositoryState,
  REQUIRED_SECTIONS,
} from '../tools/preflight-review.mjs';

const PKG_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function fixture({
  frontmatter = '',
  lessonRefs = 'See `src/app.ts` for the upload entry point.',
  referenceRefs = '',
  evidence = true,
  sectionBody = 'This section explains the concrete behavior and why it matters to the learner.',
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ams-preflight-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    'export function handleUpload(file: string) {\n  return file.trim();\n}\n',
  );
  writeFileSync(join(dir, 'Makefile'), 'build:\n\tnode src/app.ts\n');
  writeFileSync(
    join(dir, 'notes.md'),
    '# Overview\n\n## Details here\nFirst details.\n\n## Details here\nSecond duplicate heading.\n',
  );

  const sections = REQUIRED_SECTIONS.map((s) => {
    const title = s.replace(/\b\w/g, (c) => c.toUpperCase());
    return `## ${title}\n\n${sectionBody}\n`;
  });

  const body = [
    ...(frontmatter ? [frontmatter.trim(), ''] : []),
    '# 001 — File Upload Flow',
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
    evidence
      ? '| Claim | Evidence | Type | Confidence |\n|---|---|---|---|\n| rows | src/app.ts | code | high |'
      : '',
    '',
    sections[9],
  ].join('\n');

  const guide = join(dir, '001-upload.md');
  writeFileSync(guide, body);
  return { dir, guide };
}

describe('slugify and duplicate heading slugs', () => {
  test('matches GitHub heading anchors', () => {
    assert.equal(slugify('What this helps the user do'), 'what-this-helps-the-user-do');
    assert.equal(slugify('Evidence and confidence'), 'evidence-and-confidence');
    assert.equal(slugify('Technical reference'), 'technical-reference');
  });

  test('numbers duplicate headings with -1, -2 suffixes and ignores headings in code fences', () => {
    const slugs = headingSlugs([
      '# Title',
      '## Details',
      '```bash',
      '# not a heading inside bash block',
      '## Details',
      '```',
      '## Details',
      '## Details',
    ]);
    assert.ok(slugs.has('details'));
    assert.ok(slugs.has('details-1'));
    assert.ok(slugs.has('details-2'));
    assert.ok(!slugs.has('not-a-heading-inside-bash-block'));
  });
});

describe('reference extraction and fence tracking', () => {
  test('reads markdown links, inline paths, :line, #L10, arrow symbols, Makefile, and directories', () => {
    const refs = extractReferences(
      [
        'See `src/app.ts:2`, `src/app.ts#L1-L3`, `src/app.ts -> handleUpload()`, `Makefile`, `src/`, and [notes](notes.md#details-here-1).',
      ],
      null,
    );
    const targets = refs.map((r) => r.target);
    assert.ok(targets.includes('src/app.ts'));
    assert.ok(targets.includes('Makefile'));
    assert.ok(targets.includes('src/'));
    assert.ok(targets.includes('notes.md'));
    assert.equal(refs.find((r) => r.symbol)?.symbol, 'handleUpload()');
    assert.equal(refs.find((r) => r.raw === 'src/app.ts:2')?.lineStart, 2);
    assert.equal(refs.find((r) => r.raw === 'src/app.ts#L1-L3')?.lineEnd, 3);
    assert.equal(refs.find((r) => r.target === 'notes.md')?.anchor, 'details-here-1');
  });

  test('ignores backticks and links inside fenced code blocks', () => {
    const refs = extractReferences(
      [
        'Outside `src/app.ts`',
        '```ts',
        'const x = `fake/nonexistent.ts`; // [bad](missing.md)',
        '```',
      ],
      null,
    );
    assert.equal(refs.length, 1);
    assert.equal(refs[0].target, 'src/app.ts');
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
  test('accepts a clean guide with symbols, line numbers, Makefile, directory, and duplicate anchor', () => {
    const { dir, guide } = fixture({
      lessonRefs:
        'See `src/app.ts:1-2`, `src/app.ts#L2`, `src/app.ts -> handleUpload()`, `Makefile`, `src/`, and [dup](notes.md#details-here-1).',
    });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir, emitPack: true });
      assert.equal(blocking, false);
      assert.deepEqual(summary.sections.missing, []);
      assert.deepEqual(summary.sections.empty_or_placeholder, []);
      assert.equal(summary.references.missing.length, 0);
      assert.equal(summary.references.broken_anchors.length, 0);
      assert.equal(summary.references.missing_symbols.length, 0);
      assert.ok(Array.isArray(summary.evidence_pack) && summary.evidence_pack.length >= 2);
      assert.ok(summary.guide_sha256.length === 64);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports a missing symbol in an existing file', () => {
    const { dir, guide } = fixture({ lessonRefs: 'Calls `src/app.ts -> nonExistentSymbol()`.' });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.equal(summary.references.missing_symbols.length, 1);
      assert.match(summary.references.missing_symbols[0].reason, /nonExistentSymbol/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports an out-of-range line number', () => {
    const { dir, guide } = fixture({ lessonRefs: 'See `src/app.ts:99`.' });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.equal(summary.references.broken_anchors.length, 1);
      assert.match(summary.references.broken_anchors[0].reason, /out of range/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports placeholder or empty required sections', () => {
    const { dir, guide } = fixture({ sectionBody: 'placeholder' });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.ok(summary.sections.empty_or_placeholder.length >= 8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('reports missing prerequisite concepts from frontmatter assumes', () => {
    const { dir, guide } = fixture({
      frontmatter: '---\nunit_id: "002"\nunit_order: 2\nassumes: ["event loop", "message broker"]\n---',
    });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.equal(summary.concepts.missing_prerequisites.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails the permanent known-bad calibration fixture (outbox, Redis, lease, polling)', () => {
    const badGuide = join(PKG_ROOT, 'references', 'calibration-bad-guide.md');
    const { summary, blocking } = analyzeGuide({ guidePath: badGuide, repoRoot: PKG_ROOT });
    assert.equal(blocking, true);
    assert.ok(summary.concepts.premature_jargon.length > 0, 'must flag premature jargon in opening section');
    assert.ok(summary.concepts.missing_prerequisites.length > 0, 'must flag unintroduced assumed concept');
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

  test('throws for a missing guide', () => {
    assert.throws(() => analyzeGuide({ guidePath: join(tmpdir(), 'nope-xyz.md') }), /guide not found/);
  });
});

describe('gate arithmetic, delta scorecards, staleness, and convergence', () => {
  function withReport(scores, dir, extra = '') {
    const rows = scores
      .map((entry, index) => {
        if (typeof entry === 'object') {
          return `| ${index + 1}. Criterion ${index + 1} | ${entry.score} | ${entry.source} | ${entry.reason ?? 'ok'} |`;
        }
        return `| ${index + 1}. Criterion ${index + 1} | ${entry} | re-scored | because |`;
      })
      .join('\n');
    const report = join(dir, 'r.review.md');
    writeFileSync(
      report,
      `# Review\n\n${extra}\n\n| Criterion | Score (0–4) | Source | Evidence |\n|---|---:|---|---|\n${rows}\n`,
    );
    return report;
  }

  test('passes a delta report that carries unaffected scores in the 10-row table', () => {
    const { dir, guide } = fixture();
    try {
      const report = withReport(
        [
          { score: 4, source: 're-scored' },
          { score: 3, source: 're-scored' },
          { score: 3, source: 'carried from iteration 1' },
          { score: 3, source: 'carried from iteration 1' },
          { score: 3, source: 'carried from iteration 1' },
          { score: 3, source: 'carried from iteration 1' },
          { score: 3, source: 'carried from iteration 1' },
          { score: 3, source: 'carried from iteration 1' },
          { score: 3, source: 'carried from iteration 1' },
          { score: 3, source: 'carried from iteration 1' },
        ],
        dir,
      );
      const { summary } = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: report });
      assert.equal(summary.gate.passes, true);
      assert.equal(summary.gate.scores_complete, true);
      assert.equal(summary.gate.carried_criteria.length, 8);
      assert.equal(summary.gate.rescored_criteria.length, 2);
      assert.equal(summary.gate.average, 3.1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('marks a review stale when the guide or evidence file changes after the report hash', () => {
    const { dir, guide } = fixture();
    try {
      const firstPass = analyzeGuide({ guidePath: guide, repoRoot: dir });
      const report = withReport(
        [4, 3, 3, 3, 3, 3, 3, 3, 3, 3],
        dir,
        `- **Guide sha256:** \`${firstPass.summary.guide_sha256}\`\n- \`src/app.ts\`: \`${firstPass.summary.evidence_hashes['src/app.ts']}\``,
      );

      // Matches before editing
      const validCheck = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: report });
      assert.equal(validCheck.summary.gate.passes, true);
      assert.equal(validCheck.summary.stale, false);

      // Edit src/app.ts -> review becomes stale
      writeFileSync(join(dir, 'src', 'app.ts'), 'export function handleUpload() { return "changed"; }\n');
      const staleCheck = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: report });
      assert.equal(staleCheck.summary.stale, true);
      assert.equal(staleCheck.summary.gate.passes, false);
      assert.ok(staleCheck.summary.gate.stale_evidence.includes('src/app.ts'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('accepts severity-weighted convergence when count stays flat but severity drops', () => {
    const { dir, guide } = fixture();
    try {
      const history = [
        '## Revision history',
        '| Iteration | Mode | Changes checked | Findings opened | Findings closed | Open blocking | Severity weight | Result |',
        '|---|---|---|---:|---:|---:|---:|---|',
        '| 1 | full | all | 2 | 0 | 2 | 6 | NEEDS_REVISION |',
        '| 2 | delta | sec 1 | 1 | 1 | 2 | 3 | NEEDS_REVISION |',
      ].join('\n');
      const report = withReport([4, 3, 3, 3, 3, 3, 3, 3, 3, 3], dir, history);
      const { summary } = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: report });
      assert.equal(summary.gate.convergence_ok, true);
      assert.equal(summary.gate.passes, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validateRepositoryState', () => {
  test('validates progress.json, feature-register.yaml, and computes mechanical source coverage', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ams-validate-'));
    try {
      mkdirSync(join(dir, 'src'), { recursive: true });
      mkdirSync(join(dir, 'docs', 'learning'), { recursive: true });
      writeFileSync(join(dir, 'src', 'covered.ts'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'src', 'uncovered.ts'), 'export const b = 2;\n');

      writeFileSync(
        join(dir, 'docs', 'learning', 'progress.json'),
        readFileSync(join(PKG_ROOT, 'templates', 'progress-template.json'), 'utf8'),
      );
      writeFileSync(
        join(dir, 'docs', 'learning', 'feature-register.yaml'),
        [
          'repository:',
          '  name: "demo"',
          '  inspected_at: "2026-11-02"',
          '  inventory_status: "lazy"',
          'features:',
          '  - id: "F-01"',
          '    name: "Covered feature"',
          '    user_outcome: "Does A"',
          '    evidence_paths:',
          '      - "src/covered.ts"',
          '    source_status: "mapped"',
          '    review_status: "not_started"',
          '    learning_status: "not_taught"',
        ].join('\n'),
      );

      const res = validateRepositoryState({ repoRoot: dir });
      assert.equal(res.ok, true);
      assert.equal(res.progress_valid, true);
      assert.equal(res.feature_register_valid, true);
      assert.equal(res.coverage.total_source_files, 2);
      assert.equal(res.coverage.cited_source_files, 1);
      assert.deepEqual(res.coverage.uncited_files, ['src/uncovered.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
