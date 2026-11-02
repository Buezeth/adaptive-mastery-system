import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyzeGuide,
  calibrateReviewer,
  computeGuideSha256,
  extractReferences,
  headingSlugs,
  main as preflightMain,
  slugify,
  validateRepositoryState,
  REQUIRED_SECTIONS,
} from '../tools/preflight-review.mjs';

const PKG_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const DEFAULT_FRONTMATTER = [
  '---',
  'unit_id: "001-upload"',
  'unit_order: 1',
  'introduces:',
  '  - upload validation',
  'assumes: []',
  'terms: []',
  '---',
].join('\n');

function fixture({
  frontmatter = DEFAULT_FRONTMATTER,
  headerBlock = '> **Last source verification:** 2026-11-02\n> **Scope mapping:** UPLOAD-01',
  lessonRefs = 'See `src/app.ts` for the upload entry point.',
  referenceRefs = '',
  evidence = true,
  sectionBody = 'This section explains the concrete behavior and why it matters to the learner.',
  guideName = '001-upload.md',
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ams-preflight-'));
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'src', 'app.ts'),
    [
      '// Comment mentioning fakeCommentOnlySymbol that is not real code',
      'export function handleUpload(file: string) {',
      '  const msg = "stringLiteralOnlySymbol";',
      '  return file.trim() + msg;',
      '}',
      '',
    ].join('\n'),
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
    ...(headerBlock ? [headerBlock, ''] : []),
    sections[0],
    sections[1],
    sections[2],
    sections[3],
    sections[4],
    lessonRefs,
    '',
    sections[5],
    sections[6],
    sections[7],
    referenceRefs,
    '',
    sections[8],
    evidence
      ? '| Claim | Evidence | Type | Assessment | Confidence |\n|---|---|---|---|---|\n| Validates uploads | `src/app.ts -> handleUpload()` | code | intended_design | high |'
      : '',
    '',
    sections[9],
  ].join('\n');

  const guide = join(dir, guideName);
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

describe('analyzeGuide and fail-closed mechanical checks', () => {
  test('accepts a clean guide with symbols, line numbers, Makefile, and duplicate anchor', () => {
    const { dir, guide } = fixture({
      lessonRefs:
        'See `src/app.ts:1-2`, `src/app.ts#L2`, `src/app.ts -> handleUpload()`, `Makefile`, and [dup](notes.md#details-here-1).',
    });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir, emitPack: true });
      assert.equal(blocking, false);
      assert.deepEqual(summary.sections.missing, []);
      assert.deepEqual(summary.sections.empty_or_placeholder, []);
      assert.equal(summary.references.missing.length, 0);
      assert.equal(summary.references.broken_anchors.length, 0);
      assert.equal(summary.references.missing_symbols.length, 0);
      assert.equal(summary.references.vague_references.length, 0);
      assert.equal(summary.concepts.frontmatter_errors.length, 0);
      assert.ok(summary.evidence_rows >= 1);
      assert.ok(Array.isArray(summary.evidence_pack) && summary.evidence_pack.length >= 2);
      assert.ok(summary.guide_sha256.length === 64);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('guide_sha256 is invariant when Guide status or Guide sha256 header lines are edited', () => {
    const draft = [
      '# 001 — Upload',
      '',
      '> **Guide status:** Draft',
      '> **Guide sha256:** [pending]',
      '> **Review record:** not yet reviewed',
      '',
      '## Body',
      'Same lesson content.',
    ].join('\n');
    const approved = [
      '# 001 — Upload',
      '',
      '> **Guide status:** Approved',
      '> **Guide sha256:** 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      '> **Review record:** docs/learning/reviews/001.review.md',
      '',
      '## Body',
      'Same lesson content.',
    ].join('\n');
    assert.equal(computeGuideSha256(draft), computeGuideSha256(approved));
  });

  test('rejects the unedited templates/feature-guide-template.md as placeholder content', () => {
    const templatePath = join(PKG_ROOT, 'templates', 'feature-guide-template.md');
    const { summary, blocking } = analyzeGuide({ guidePath: templatePath, repoRoot: PKG_ROOT });
    assert.equal(blocking, true);
    assert.ok(
      summary.sections.empty_or_placeholder.length >= 10,
      'must flag unedited template sections',
    );
    assert.ok(
      summary.concepts.frontmatter_errors.length > 0,
      'must reject 000-template frontmatter',
    );
    assert.equal(summary.evidence_rows, 0, 'must not count unedited template evidence row');
  });

  test('rejects a guide with missing YAML frontmatter', () => {
    const { dir, guide } = fixture({ frontmatter: '' });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.ok(summary.concepts.frontmatter_errors.length > 0);
      assert.match(summary.concepts.frontmatter_errors[0], /missing YAML frontmatter/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('checks assumes prerequisites even when unit_order is missing and filename has no numeric prefix', () => {
    const { dir, guide } = fixture({
      guideName: 'upload-without-number.md',
      frontmatter: '---\nunit_id: "upload"\nintroduces: []\nassumes: ["unintroduced concept"]\n---',
    });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.equal(summary.concepts.missing_prerequisites.length, 1);
      assert.equal(summary.concepts.missing_prerequisites[0].concept, 'unintroduced concept');
      assert.ok(summary.concepts.frontmatter_errors.some((e) => /unit_order/.test(e)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('blocks when Evidence and confidence has 0 populated rows', () => {
    const { dir, guide } = fixture({ evidence: false });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.equal(summary.evidence_rows, 0);
      assert.ok(
        summary.sections.empty_or_placeholder.some((s) => s.includes('evidence and confidence')),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects symbols that only appear inside comments or string literals', () => {
    const { dir, guide } = fixture({
      lessonRefs:
        'Calls `src/app.ts -> fakeCommentOnlySymbol()` and `src/app.ts -> stringLiteralOnlySymbol()`.',
    });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.equal(summary.references.missing_symbols.length, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('rejects vague directory references', () => {
    const { dir, guide } = fixture({ lessonRefs: 'Explore `src/` for details.' });
    try {
      const { summary, blocking } = analyzeGuide({ guidePath: guide, repoRoot: dir });
      assert.equal(blocking, true);
      assert.equal(summary.references.vague_references.length, 1);
      assert.match(summary.references.vague_references[0].reason, /directory reference.*too vague/i);
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

  test('blocks a bare repo-root clickable markdown link inside a subfolder guide and suggests the relative path', () => {
    const { dir, guide } = fixture();
    try {
      const subDir = join(dir, 'docs', 'learning', 'guides');
      mkdirSync(subDir, { recursive: true });
      const subGuide = join(subDir, '01-virtual-scroll.md');
      // Write a guide in docs/learning/guides/ with a bare [src/app.ts:2](src/app.ts#L2) link in Section 5
      const content = readFileSync(guide, 'utf8').replace(
        'See `src/app.ts` for the upload entry point.',
        'See [src/app.ts:2](src/app.ts#L2) for the upload entry point.',
      );
      writeFileSync(subGuide, content);

      const badRes = analyzeGuide({ guidePath: subGuide, repoRoot: dir });
      assert.equal(badRes.blocking, true);
      assert.equal(badRes.summary.references.missing.length, 1);
      assert.match(
        badRes.summary.references.missing[0].reason,
        /will 404 in Markdown preview; use "\.\.\/\.\.\/\.\.\/src\/app\.ts#L2"/,
      );

      // Now fix the link to use ../../../src/app.ts#L2 (or /src/app.ts#L2) and verify it passes
      const fixedContent = content.replace(
        '[src/app.ts:2](src/app.ts#L2)',
        '[src/app.ts:2](../../../src/app.ts#L2) and [root](/src/app.ts#L2)',
      );
      writeFileSync(subGuide, fixedContent);
      const goodRes = analyzeGuide({ guidePath: subGuide, repoRoot: dir });
      assert.equal(goodRes.blocking, false);
      assert.equal(goodRes.summary.references.missing.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('throws for a missing guide', () => {
    assert.throws(() => analyzeGuide({ guidePath: join(tmpdir(), 'nope-xyz.md') }), /guide not found/);
  });
});

describe('gate arithmetic, hash binding, finding derivation, staleness, and convergence', () => {
  function withReport(scores, dir, { guideInfo = null, extra = '' } = {}) {
    const rows = scores
      .map((entry, index) => {
        if (typeof entry === 'object') {
          return `| ${index + 1}. Criterion ${index + 1} | ${entry.score} | ${entry.source} | ${entry.reason ?? 'ok'} |`;
        }
        return `| ${index + 1}. Criterion ${index + 1} | ${entry} | re-scored | because |`;
      })
      .join('\n');

    const hashLines = [];
    if (guideInfo) {
      hashLines.push(`- **Guide sha256:** \`${guideInfo.guide_sha256}\``);
      for (const [relPath, hash] of Object.entries(guideInfo.evidence_hashes ?? {})) {
        const regionHash = guideInfo.evidence_region_hashes?.[relPath];
        hashLines.push(
          regionHash
            ? `- \`${relPath}\`: \`${hash}\` (region: \`${regionHash}\`)`
            : `- \`${relPath}\`: \`${hash}\``,
        );
      }
    }

    const report = join(dir, 'r.review.md');
    writeFileSync(
      report,
      `# Review\n\n${hashLines.join('\n')}\n\n${extra}\n\n| Criterion | Score (0–4) | Source | Evidence |\n|---|---:|---|---|\n${rows}\n`,
    );
    return report;
  }

  test('a failing gate causes analyzeGuide and preflight CLI to exit 1 (blocking)', () => {
    const { dir, guide } = fixture();
    try {
      const firstPass = analyzeGuide({ guidePath: guide, repoRoot: dir });
      const report = withReport([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], dir, {
        guideInfo: firstPass.summary,
      });
      const { summary, blocking } = analyzeGuide({
        guidePath: guide,
        repoRoot: dir,
        reviewReport: report,
      });
      assert.equal(summary.gate.passes, false);
      assert.equal(blocking, true, 'failing gate must mark preflight as blocking');
      const code = preflightMain([
        'node',
        'preflight-review.mjs',
        guide,
        '--repo-root',
        dir,
        '--review-report',
        report,
      ]);
      assert.equal(code, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails when bind_approval_to_guide_and_evidence_hashes is true and report omits hashes', () => {
    const { dir, guide } = fixture();
    try {
      const reportWithoutHashes = withReport([4, 3, 3, 3, 3, 3, 3, 3, 3, 3], dir);
      const { summary, blocking } = analyzeGuide({
        guidePath: guide,
        repoRoot: dir,
        reviewReport: reportWithoutHashes,
      });
      assert.equal(summary.gate.passes, false);
      assert.equal(blocking, true);
      assert.ok(summary.gate.reasons.some((r) => /missing Guide sha256/i.test(r)));
      assert.ok(summary.gate.reasons.some((r) => /missing evidence hash/i.test(r)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('passes a delta report that carries unaffected scores in the 10-row table and binds hashes', () => {
    const { dir, guide } = fixture();
    try {
      const firstPass = analyzeGuide({ guidePath: guide, repoRoot: dir });
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
        { guideInfo: firstPass.summary },
      );
      const { summary, blocking } = analyzeGuide({
        guidePath: guide,
        repoRoot: dir,
        reviewReport: report,
      });
      assert.equal(summary.gate.passes, true);
      assert.equal(blocking, false);
      assert.equal(summary.gate.scores_complete, true);
      assert.equal(summary.gate.carried_criteria.length, 8);
      assert.equal(summary.gate.rescored_criteria.length, 2);
      assert.equal(summary.gate.average, 3.1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('distinguishes soft staleness (edit outside cited region) from hard staleness (edit inside cited region)', () => {
    const { dir, guide } = fixture({
      lessonRefs: 'See `src/app.ts:2-5` for the upload function.',
    });
    try {
      // Make src/app.ts have 40 lines so lines 35-40 are outside the cited region (1..20)
      const initialLines = [
        '// line 1',
        'export function handleUpload(file: string) {',
        '  return file.trim();',
        '}',
        ...Array.from({ length: 35 }, (_, i) => `// padding line ${i + 5}`),
      ];
      writeFileSync(join(dir, 'src', 'app.ts'), `${initialLines.join('\n')}\n`);

      const firstPass = analyzeGuide({ guidePath: guide, repoRoot: dir });
      const report = withReport([4, 3, 3, 3, 3, 3, 3, 3, 3, 3], dir, {
        guideInfo: firstPass.summary,
      });

      // 1. Edit line 38 (outside cited region 1..20) -> soft_stale: true, stale: false, gate still passes
      const outsideEdit = [...initialLines];
      outsideEdit[37] = '// edited unrelated helper comment at bottom of file';
      writeFileSync(join(dir, 'src', 'app.ts'), `${outsideEdit.join('\n')}\n`);

      const softCheck = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: report });
      assert.equal(softCheck.summary.soft_stale, true);
      assert.equal(softCheck.summary.stale, false);
      assert.equal(softCheck.summary.gate.passes, true);
      assert.ok(softCheck.summary.gate.soft_stale_evidence.includes('src/app.ts'));

      // 2. Edit line 3 (inside cited region) -> hard stale: true, gate fails
      const insideEdit = [...outsideEdit];
      insideEdit[2] = '  return file.toLowerCase();';
      writeFileSync(join(dir, 'src', 'app.ts'), `${insideEdit.join('\n')}\n`);

      const hardCheck = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: report });
      assert.equal(hardCheck.summary.stale, true);
      assert.equal(hardCheck.summary.gate.passes, false);
      assert.equal(hardCheck.blocking, true);
      assert.ok(hardCheck.summary.gate.stale_evidence.includes('src/app.ts'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('derives open blocking findings and severity weight from ### [F-xx] blocks and detects self-reported table mismatch', () => {
    const { dir, guide } = fixture();
    try {
      const firstPass = analyzeGuide({ guidePath: guide, repoRoot: dir });
      const extraWithOpenFinding = [
        '## Blocking findings',
        '### [F-01] Unexplained term in section 1',
        '- **Status:** `open`',
        '- **Severity:** `critical`',
        '## Revision history',
        '| Iteration | Mode | Changes checked | Findings opened | Findings closed | Open blocking | Severity weight | Result |',
        '|---|---|---|---:|---:|---:|---:|---|',
        '| 1 | full | all | 1 | 0 | 0 | 0 | PASS |',
      ].join('\n');

      const badReport = withReport([4, 3, 3, 3, 3, 3, 3, 3, 3, 3], dir, {
        guideInfo: firstPass.summary,
        extra: extraWithOpenFinding,
      });
      const check1 = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: badReport });
      assert.equal(check1.summary.gate.passes, false);
      assert.equal(check1.summary.gate.open_blocking_findings, 1);
      assert.equal(check1.summary.gate.open_severity_weight, 3);
      assert.ok(
        check1.summary.gate.reasons.some((r) => /self-reported open_blocking.*does not match/i.test(r)),
      );

      // Now close F-01 and update history table
      const extraClosed = [
        '## Blocking findings',
        '### [F-01] Unexplained term in section 1',
        '- **Status:** `closed`',
        '- **Severity:** `critical`',
        '## Revision history',
        '| Iteration | Mode | Changes checked | Findings opened | Findings closed | Open blocking | Severity weight | Result |',
        '|---|---|---|---:|---:|---:|---:|---|',
        '| 1 | full | all | 1 | 0 | 1 | 3 | NEEDS_REVISION |',
        '| 2 | delta | sec 1 | 0 | 1 | 0 | 0 | PASS |',
      ].join('\n');

      const goodReport = withReport([4, 3, 3, 3, 3, 3, 3, 3, 3, 3], dir, {
        guideInfo: firstPass.summary,
        extra: extraClosed,
      });
      const check2 = analyzeGuide({ guidePath: guide, repoRoot: dir, reviewReport: goodReport });
      assert.equal(check2.summary.gate.passes, true);
      assert.equal(check2.summary.gate.open_blocking_findings, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('checks only the latest transition for convergence so an earlier stalled round does not block approval forever', () => {
    const { dir, guide } = fixture();
    try {
      const firstPass = analyzeGuide({ guidePath: guide, repoRoot: dir });
      const history = [
        '## Revision history',
        '| Iteration | Mode | Changes checked | Findings opened | Findings closed | Open blocking | Severity weight | Result |',
        '|---|---|---|---:|---:|---:|---:|---|',
        '| 1 | full | all | 2 | 0 | 2 | 5 | NEEDS_REVISION |',
        '| 2 | delta | sec 1 | 0 | 0 | 2 | 5 | NEEDS_REVISION (stalled) |',
        '| 3 | delta | strategy_change | 0 | 2 | 0 | 0 | PASS |',
      ].join('\n');
      const report = withReport([4, 3, 3, 3, 3, 3, 3, 3, 3, 3], dir, {
        guideInfo: firstPass.summary,
        extra: history,
      });
      const { summary, blocking } = analyzeGuide({
        guidePath: guide,
        repoRoot: dir,
        reviewReport: report,
      });
      assert.equal(summary.gate.convergence_ok, true);
      assert.equal(summary.gate.stalled_transitions.length, 1);
      assert.equal(summary.gate.passes, true);
      assert.equal(blocking, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fails the gate when Guess log contains an unresolved [on-ramp] entry', () => {
    const { dir, guide } = fixture();
    try {
      const firstPass = analyzeGuide({ guidePath: guide, repoRoot: dir });
      const guessSection = [
        '## Guess log',
        '',
        '- [on-ramp] (section 2, line 23) window.scrollY — had to guess what this meant',
        '- [later] (section 6, line 50) minor note in later section',
      ].join('\n');
      const report = withReport([4, 3, 3, 3, 3, 3, 3, 3, 3, 3], dir, {
        guideInfo: firstPass.summary,
        extra: guessSection,
      });
      const { summary, blocking } = analyzeGuide({
        guidePath: guide,
        repoRoot: dir,
        reviewReport: report,
      });
      assert.equal(summary.gate.passes, false);
      assert.equal(blocking, true);
      assert.equal(summary.gate.open_guesses.length, 1);
      assert.ok(summary.gate.reasons.some((r) => /guess log has 1 unresolved \[on-ramp\] entry/i.test(r)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('validateRepositoryState and calibrateReviewer', () => {
  test('excludes .d.ts and snapshot globs, rejects directory citations, enforces minimum ratio, and requires verification tasks for understood items', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ams-validate-'));
    try {
      mkdirSync(join(dir, 'src', '__snapshots__'), { recursive: true });
      mkdirSync(join(dir, 'docs', 'learning'), { recursive: true });
      writeFileSync(join(dir, 'src', 'covered.ts'), 'export const a = 1;\n');
      writeFileSync(join(dir, 'src', 'uncovered.ts'), 'export const b = 2;\n');
      // Ignored by default globs:
      writeFileSync(join(dir, 'src', 'types.d.ts'), 'export type T = string;\n');
      writeFileSync(join(dir, 'src', '__snapshots__', 'app.snap'), 'snapshot\n');

      const progressTemplate = JSON.parse(
        readFileSync(join(PKG_ROOT, 'templates', 'progress-template.json'), 'utf8'),
      );
      progressTemplate.learner_model.concepts = {
        'upload validation': 'understood',
      };
      progressTemplate.learner_model.completed_verification_tasks = [];
      writeFileSync(
        join(dir, 'docs', 'learning', 'progress.json'),
        JSON.stringify(progressTemplate, null, 2),
      );

      writeFileSync(
        join(dir, 'docs', 'learning', 'feature-register.yaml'),
        [
          'repository:',
          '  name: "demo"',
          '  inspected_at: "2026-11-02"',
          '  inventory_status: "reconciled"',
          'features:',
          '  - id: "F-01"',
          '    name: "Covered feature"',
          '    user_outcome: "Does A"',
          '    evidence_paths:',
          '      - "src/"',
          '      - "src/covered.ts"',
          '    source_status: "mapped"',
          '    review_status: "approved"',
          '    learning_status: "understood"',
        ].join('\n'),
      );

      const failRes = validateRepositoryState({ repoRoot: dir });
      assert.equal(failRes.ok, false);
      // .d.ts and .snap were ignored, so total_source_files is 2 (covered.ts and uncovered.ts)
      assert.equal(failRes.coverage.total_source_files, 2);
      assert.equal(failRes.coverage.cited_source_files, 1);
      assert.ok(failRes.problems.some((p) => /cites directory "src\/"/i.test(p)));
      assert.ok(failRes.problems.some((p) => /marked approved but is missing guide_path/i.test(p)));
      assert.ok(failRes.problems.some((p) => /learning_status "understood" without a completed verification task/i.test(p)));
      assert.ok(failRes.problems.some((p) => /concept "upload validation" is marked "understood" without/i.test(p)));
      assert.ok(failRes.problems.some((p) => /coverage 0\.5.*below required minimum 1/i.test(p)));

      // Now fix all issues: add completed verification task, cite both files, set lazy status
      progressTemplate.learner_model.completed_verification_tasks = [
        { unit_id: 'F-01', concept: 'upload validation', type: 'explain_back' },
      ];
      writeFileSync(
        join(dir, 'docs', 'learning', 'progress.json'),
        JSON.stringify(progressTemplate, null, 2),
      );
      writeFileSync(
        join(dir, 'docs', 'learning', 'feature-register.yaml'),
        [
          'repository:',
          '  name: "demo"',
          '  inspected_at: "2026-11-02"',
          '  inventory_status: "reconciled"',
          'features:',
          '  - id: "F-01"',
          '    name: "Covered feature"',
          '    user_outcome: "Does A"',
          '    evidence_paths:',
          '      - "src/covered.ts"',
          '      - "src/uncovered.ts"',
          '    source_status: "mapped"',
          '    review_status: "not_started"',
          '    learning_status: "understood"',
        ].join('\n'),
      );

      const passRes = validateRepositoryState({ repoRoot: dir });
      assert.equal(passRes.ok, true);
      assert.equal(passRes.coverage.coverage_ratio, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('calibrateReviewer verifies both mechanical rejection and reviewer scorecard on calibration-bad-guide.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ams-calibrate-'));
    try {
      const goodReviewerReport = join(dir, 'good-cal.review.md');
      writeFileSync(
        goodReviewerReport,
        [
          '# Calibration Review',
          '- **Review status:** `NEEDS_REVISION`',
          '| Criterion | Score (0–4) | Source | Evidence |',
          '|---|---:|---|---|',
          '| 1. Grounded accuracy | 2 | re-scored | ok |',
          '| 2. Purpose before machinery | 1 | re-scored | jargon first |',
          '| 3. Prerequisite handling | 0 | re-scored | missing lock manager |',
          '| 4. Conceptual load and terminology timing | 1 | re-scored | 5 terms in para 1 |',
          '| 5. Cause-and-effect clarity | 2 | re-scored | ok |',
          '| 6. Concrete grounding | 2 | re-scored | ok |',
          '| 7. Sequence and coherence | 1 | re-scored | ok |',
          '| 8. Engagement and pacing | 1 | re-scored | ok |',
          '| 9. Depth and reference usefulness | 2 | re-scored | ok |',
          '| 10. Independent capability | 1 | re-scored | ok |',
        ].join('\n'),
      );

      const passCal = calibrateReviewer({
        repoRoot: PKG_ROOT,
        reviewReport: goodReviewerReport,
        model: 'test-model-v1',
      });
      assert.equal(passCal.ok, true);
      assert.equal(passCal.mechanical_ok, true);
      assert.equal(passCal.reviewer_ok, true);

      // A lenient reviewer that scores 3 on Criterion 2 fails calibration
      const lenientReport = join(dir, 'bad-cal.review.md');
      writeFileSync(
        lenientReport,
        readFileSync(goodReviewerReport, 'utf8').replace(
          '| 2. Purpose before machinery | 1 |',
          '| 2. Purpose before machinery | 3 |',
        ),
      );
      const failCal = calibrateReviewer({
        repoRoot: PKG_ROOT,
        reviewReport: lenientReport,
      });
      assert.equal(failCal.ok, false);
      assert.equal(failCal.reviewer_ok, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
