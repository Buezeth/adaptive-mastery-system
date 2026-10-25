#!/usr/bin/env node
/**
 * Stage 0 review preflight: deterministic checks that must never consume a reviewer pass.
 *
 * Resolves every learner-facing reference in a feature guide, validates same-document and
 * cross-document anchors, checks the template's required sections, counts evidence-table rows,
 * and optionally recomputes the approval gate from an existing review report.
 *
 * Prints one JSON object on stdout. No network access, no repository mutation, no code execution.
 *
 * Exit codes: 0 = clean, 1 = blocking problem, 2 = usage or input error.
 */
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative, isAbsolute, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_SECTIONS = [
  'what this helps the user do',
  'why the feature needs to exist',
  'the first idea to understand',
  'follow one real example',
  'how the implementation makes it happen',
  'what happens when things do not go as expected',
  'how this connects to the rest of the codebase',
  'technical reference',
  'evidence and confidence',
  'what you should now be able to reason about',
];

const SOURCE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'cs',
  'fs', 'php', 'swift', 'm', 'mm', 'c', 'h', 'cc', 'cpp', 'hpp', 'scala', 'ex', 'exs', 'sql',
  'yaml', 'yml', 'json', 'toml', 'md', 'sh', 'bash', 'ps1', 'proto', 'graphql', 'gql', 'css',
  'scss', 'html', 'vue', 'svelte',
];

const PATH_PATTERN = new RegExp(`^[\\w.\\-/\\\\@]+\\.(${SOURCE_EXTENSIONS.join('|')})$`);
const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CODE_PATTERN = /`([^`]+)`/g;
const HEADING_PATTERN = /^(#{1,6})\s+(.*?)\s*$/;

/** GitHub-style heading slug, unicode aware. */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{Nd}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function readLines(file) {
  return readFileSync(file, 'utf8').split(/\r?\n/);
}

function toPosix(value) {
  return sep === '/' ? value : value.split(sep).join('/');
}

function findRepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function headingSlugs(lines) {
  const slugs = new Set();
  for (const line of lines) {
    const m = HEADING_PATTERN.exec(line);
    if (m) {
      const s = slugify(m[2]);
      if (s) slugs.add(s);
    }
  }
  return slugs;
}

/** Extract candidate references with their line number and layer. */
export function extractReferences(lines, layerSplitLine) {
  const refs = [];
  const push = (lineNumber, raw, syntax) => {
    let value = raw.trim();
    if (!value) return;
    if (/^(https?:|mailto:|tel:|www\.)/i.test(value)) return;
    const angle = /^<(.+)>$/.exec(value);
    if (angle) value = angle[1];

    let target = value;
    let anchor = null;
    const hash = /^([^#]*)#(.+)$/.exec(value);
    if (hash) {
      target = hash[1];
      anchor = hash[2];
    }
    if (value.startsWith('#')) {
      target = '';
      anchor = value.slice(1);
    }

    const layer =
      layerSplitLine && lineNumber >= layerSplitLine ? 'reference' : 'lesson';
    refs.push({ line: lineNumber, layer, syntax, raw: value, target, anchor });
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    for (const m of line.matchAll(LINK_PATTERN)) push(lineNumber, m[1], 'markdown-link');
    for (const m of line.matchAll(CODE_PATTERN)) {
      let token = m[1].trim();
      if (token.includes('->')) token = token.split('->')[0].trim();
      token = token.replace(/\(\)$/, '');
      if (PATH_PATTERN.test(token)) push(lineNumber, token, 'inline-path');
    }
  });

  return refs;
}

function resolveTarget(target, guideDir, repoRoot) {
  const candidates = [];
  if (!target) return null;
  if (isAbsolute(target)) candidates.push(target);
  else {
    candidates.push(join(guideDir, target));
    candidates.push(join(repoRoot, target));
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return resolve(candidate);
    } catch {
      /* unreadable candidate: keep looking */
    }
  }
  return null;
}

function parseGate(reportPath) {
  const lines = readLines(reportPath);
  const scores = new Map();
  for (const line of lines) {
    const m = /^\|\s*(\d{1,2})\.\s*([^|]+?)\s*\|\s*([0-4])\s*\|/.exec(line);
    if (m) scores.set(Number(m[1]), Number(m[3]));
  }

  const hard = [1, 2, 3, 4, 5];
  const reasons = [];
  const complete = scores.size === 10;

  let sum = 0;
  for (const score of scores.values()) sum += score;
  const average = scores.size ? Math.round((sum / scores.size) * 100) / 100 : 0;

  if (!complete) reasons.push(`scorecard incomplete: ${scores.size} of 10 criteria scored`);
  for (const criterion of hard) {
    if (!scores.has(criterion)) reasons.push(`criterion ${criterion} missing`);
    else if (scores.get(criterion) < 3) {
      reasons.push(`criterion ${criterion} scored ${scores.get(criterion)}, gate requires >=3`);
    }
  }
  for (let criterion = 1; criterion <= 10; criterion += 1) {
    if (hard.includes(criterion)) continue;
    if (scores.has(criterion) && scores.get(criterion) < 2) {
      reasons.push(`criterion ${criterion} scored ${scores.get(criterion)}, gate requires >=2`);
    }
  }
  if (average < 3.0) reasons.push(`average ${average} below 3.0`);

  return {
    scores_complete: complete,
    scores: [...scores.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([criterion, score]) => ({ criterion, score })),
    average,
    passes: reasons.length === 0,
    reasons,
  };
}

/**
 * Analyze one guide.
 * @returns {{summary: object, blocking: boolean}}
 */
export function analyzeGuide({ guidePath, repoRoot, reviewReport }) {
  const guideFull = resolve(guidePath);
  if (!existsSync(guideFull)) {
    const error = new Error(`guide not found: ${guidePath}`);
    error.code = 'ENOENT_GUIDE';
    throw error;
  }
  const guideDir = dirname(guideFull);
  const root = resolve(repoRoot ?? findRepoRoot(guideDir) ?? guideDir);

  const lines = readLines(guideFull);

  const headings = [];
  let layerSplitLine = null;
  lines.forEach((line, index) => {
    const m = HEADING_PATTERN.exec(line);
    if (!m) return;
    const level = m[1].length;
    const title = m[2];
    headings.push({ line: index + 1, level, title });
    if (level <= 2 && /^technical reference/i.test(title) && layerSplitLine === null) {
      layerSplitLine = index + 1;
    }
  });

  const topLevelTitles = headings.filter((h) => h.level <= 2).map((h) => h.title.toLowerCase());
  const missingSections = REQUIRED_SECTIONS.filter(
    (required) => !topLevelTitles.some((title) => title.includes(required)),
  );

  const guideSlugs = headingSlugs(lines);
  const refs = extractReferences(lines, layerSplitLine);

  const resolved = [];
  const missing = [];
  const brokenAnchors = [];
  const seen = new Set();

  for (const ref of refs) {
    const key = `${ref.layer}|${ref.target}|${ref.anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!ref.target) {
      if (guideSlugs.has(slugify(ref.anchor))) {
        resolved.push({ line: ref.line, layer: ref.layer, raw: ref.raw, kind: 'anchor', path: toPosix(relative(root, guideFull)) });
      } else {
        brokenAnchors.push({ line: ref.line, layer: ref.layer, raw: ref.raw, anchor: ref.anchor, reason: 'no matching heading in this guide' });
      }
      continue;
    }

    const targetPath = resolveTarget(ref.target, guideDir, root);
    if (!targetPath) {
      missing.push({ line: ref.line, layer: ref.layer, raw: ref.raw, target: ref.target, reason: 'path does not exist from guide directory or repository root' });
      continue;
    }

    if (ref.anchor && targetPath.endsWith('.md')) {
      const targetSlugs = headingSlugs(readLines(targetPath));
      if (!targetSlugs.has(slugify(ref.anchor))) {
        brokenAnchors.push({ line: ref.line, layer: ref.layer, raw: ref.raw, anchor: ref.anchor, reason: `heading not found in ${toPosix(relative(root, targetPath))}` });
        continue;
      }
    }

    resolved.push({
      line: ref.line,
      layer: ref.layer,
      raw: ref.raw,
      kind: targetPath.endsWith('.md') ? 'document' : 'source',
      path: toPosix(relative(root, targetPath)),
    });
  }

  let evidenceRows = 0;
  let inEvidence = false;
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      inEvidence = /^#{1,6}\s+evidence and confidence/i.test(line);
      continue;
    }
    if (!inEvidence || !/^\s*\|/.test(line)) continue;
    if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) continue;
    if (/^\s*\|\s*claim\s*\|/i.test(line)) continue;
    if (line.trim().length > 3) evidenceRows += 1;
  }

  const blocking = missingSections.length + missing.length + brokenAnchors.length > 0;

  const summary = {
    guide: toPosix(relative(root, guideFull)),
    repo_root: toPosix(root),
    layer_split_line: layerSplitLine,
    sections: {
      found: headings.filter((h) => h.level <= 2).map((h) => h.title),
      missing: missingSections,
    },
    references: {
      resolved_lesson: resolved.filter((r) => r.layer === 'lesson').length,
      resolved_reference: resolved.filter((r) => r.layer === 'reference').length,
      missing,
      broken_anchors: brokenAnchors,
    },
    evidence_rows: evidenceRows,
    gate: reviewReport ? parseGate(resolve(reviewReport)) : null,
    blocking_problems: blocking,
    checked_at: new Date().toISOString(),
  };

  return { summary, blocking };
}

const USAGE = `Preflight a feature guide before review.

Usage
  node tools/preflight-review.mjs <guide.md> [options]

Options
  --repo-root <dir>       Repository root for resolving references. Default: nearest .git
  --review-report <file>  Recompute the approval gate from a review report
  --out <file>            Also write the JSON result here
  --help                  Show this message

Exit codes: 0 clean, 1 blocking problem, 2 usage/input error.
`;

export function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }

  let guidePath = null;
  let repoRoot = null;
  let reviewReport = null;
  let outFile = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--repo-root') repoRoot = args[++i];
    else if (arg === '--review-report') reviewReport = args[++i];
    else if (arg === '--out') outFile = args[++i];
    else if (arg.startsWith('--')) {
      process.stderr.write(`preflight: unknown option ${arg}\n`);
      return 2;
    } else if (!guidePath) guidePath = arg;
    else {
      process.stderr.write(`preflight: unexpected argument ${arg}\n`);
      return 2;
    }
  }

  if (!guidePath) {
    process.stderr.write(USAGE);
    return 2;
  }

  let result;
  try {
    result = analyzeGuide({ guidePath, repoRoot, reviewReport });
  } catch (error) {
    process.stderr.write(`preflight: ${error.message}\n`);
    return 2;
  }

  const json = JSON.stringify(result.summary, null, 2);
  process.stdout.write(`${json}\n`);
  if (outFile) {
    mkdirSync(dirname(resolve(outFile)), { recursive: true });
    writeFileSync(resolve(outFile), json);
  }
  return result.blocking ? 1 : 0;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  process.exitCode = main(process.argv);
}
