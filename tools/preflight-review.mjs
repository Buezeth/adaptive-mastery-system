#!/usr/bin/env node
/**
 * Stage 0 review preflight and learning-state validator: deterministic checks that must never
 * consume a reviewer pass.
 *
 * Resolves every learner-facing reference in a feature guide (including path:line, path#L10,
 * path -> symbol(), extensionless files like Makefile, and directories), validates same-document
 * and cross-document anchors (with GitHub -1/-2 duplicate slugs), tracks code fences, checks
 * required sections and non-placeholder content, verifies concept prerequisites and premature
 * jargon, computes guide and evidence SHA-256 hashes for staleness detection, optionally emits
 * an inlined evidence pack (--emit-pack), and recomputes the approval gate from config thresholds.
 *
 * Prints one JSON object on stdout. No network access, no repository mutation, no code execution.
 *
 * Exit codes: 0 = clean, 1 = blocking problem, 2 = usage or input error.
 */
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, realpathSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative, isAbsolute, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const KIT_ROOT = resolve(dirname(THIS_FILE), '..');

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
  'scss', 'html', 'vue', 'svelte', 'mdc', 'txt', 'xml', 'ini', 'cfg', 'conf', 'lock',
];

const EXTENSIONLESS_FILES = new Set([
  'Makefile', 'GNUmakefile', 'Dockerfile', 'Containerfile', 'Procfile', 'Justfile',
  'Gemfile', 'Rakefile', 'Vagrantfile', 'Brewfile', 'CODEOWNERS', 'LICENSE', 'README',
  'CHANGELOG', 'CONTRIBUTING',
]);

const DEFAULT_JARGON_WATCHLIST = [
  'transactional outbox',
  'outbox',
  'idempotency',
  'idempotent',
  'lease',
  'polling',
  'bullmq',
  'redis',
  'dead-letter',
  'dlq',
  'backpressure',
  'circuit breaker',
  'eventual consistency',
  'two-phase commit',
  'cqrs',
  'event sourcing',
  'kafka',
  'rabbitmq',
];

const PATH_EXT_PATTERN = new RegExp(`^[\\w.\\-/\\\\@]+\\.(${SOURCE_EXTENSIONS.join('|')})$`);
const DIR_PATH_PATTERN = /^[\w.\-@]+(?:[/\\][\w.\-@]*)*\/$/;
const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CODE_PATTERN = /`([^`]+)`/g;
const HEADING_PATTERN = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const PLACEHOLDER_BODY_PATTERN = /^(?:placeholder|todo|tbd|n\/a|none|coming soon|fill me in|\.\.\.|…|\[(?:placeholder|todo|tbd|fill[^\]]*)\]|<(?:placeholder|todo|tbd)>)$/i;

/** Normalize CRLF -> LF and compute SHA-256 hex digest. */
export function sha256Normalized(content) {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function sha256FileNormalized(filePath) {
  return sha256Normalized(readFileSync(filePath, 'utf8'));
}

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
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
}

function toPosix(value) {
  return sep === '/' ? value : value.split(sep).join('/');
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findRepoRoot(startDir) {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, '.git')) || existsSync(join(dir, '.adaptive-mastery'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/* ----------------------------------------------------- zero-dep yaml/config */

function parseScalar(raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null' || trimmed === '~') return null;
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
  if (/^-?\d+\.\d+$/.test(trimmed)) return Number(trimmed);
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => parseScalar(item));
  }
  return trimmed;
}

function stripInlineComment(value) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value.trimEnd();
}

/**
 * Parse flat and section-nested YAML into `{ flat, sections }`.
 */
export function parseSimpleYaml(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const flat = {};
  const sections = {};
  let currentSection = null;
  let currentListKey = null;

  for (const rawLine of lines) {
    const cleaned = stripInlineComment(rawLine);
    if (!cleaned.trim() || cleaned.trim().startsWith('#')) continue;

    const indent = rawLine.match(/^ */)[0].length;
    const trimmed = cleaned.trim();

    if (trimmed.startsWith('- ')) {
      const itemVal = parseScalar(trimmed.slice(2));
      if (currentListKey) {
        if (!Array.isArray(flat[currentListKey])) flat[currentListKey] = [];
        flat[currentListKey].push(itemVal);
        if (currentSection && sections[currentSection]) {
          if (!Array.isArray(sections[currentSection][currentListKey])) {
            sections[currentSection][currentListKey] = [];
          }
          sections[currentSection][currentListKey].push(itemVal);
        }
      }
      continue;
    }

    const kv = /^([\w.-]+)\s*:\s*(.*)$/.exec(trimmed);
    if (!kv) continue;
    const [, key, rest] = kv;

    if (indent === 0 && rest === '') {
      currentSection = key;
      if (!sections[currentSection]) sections[currentSection] = {};
      currentListKey = key;
      flat[key] = [];
      continue;
    }

    if (rest === '') {
      currentListKey = key;
      flat[key] = [];
      if (indent > 0 && currentSection) {
        sections[currentSection][key] = [];
      }
      continue;
    }

    currentListKey = null;
    const val = parseScalar(rest);
    flat[key] = val;
    if (indent > 0 && currentSection) {
      if (!sections[currentSection]) sections[currentSection] = {};
      sections[currentSection][key] = val;
    }
  }

  return { flat, sections };
}

/**
 * Load mastery-system configuration from kit defaults overlaid with repo/local overrides.
 */
export function loadMasteryConfig(repoRoot) {
  const candidates = [
    join(KIT_ROOT, 'config', 'mastery-system.yaml'),
  ];
  if (repoRoot) {
    candidates.push(
      join(repoRoot, '.adaptive-mastery', 'config', 'mastery-system.yaml'),
      join(repoRoot, 'config', 'mastery-system.yaml'),
      join(repoRoot, 'docs', 'learning', 'config.local.yaml'),
    );
  }

  const mergedFlat = {};
  const mergedSections = {};
  const loadedFrom = [];

  for (const file of new Set(candidates.map((c) => resolve(c)))) {
    if (!existsSync(file)) continue;
    try {
      const parsed = parseSimpleYaml(readFileSync(file, 'utf8'));
      Object.assign(mergedFlat, parsed.flat);
      for (const [sec, obj] of Object.entries(parsed.sections)) {
        mergedSections[sec] = { ...(mergedSections[sec] ?? {}), ...obj };
      }
      loadedFrom.push(file);
    } catch {
      /* ignore unreadable override */
    }
  }

  const review = mergedSections.review ?? {};
  const paths = mergedSections.paths ?? {};
  const getReview = (key, fallback) =>
    review[key] !== undefined ? review[key] : (mergedFlat[key] !== undefined ? mergedFlat[key] : fallback);

  return {
    loadedFrom,
    paths: {
      learning_root: paths.learning_root ?? 'docs/learning',
      local_config: paths.local_config ?? 'docs/learning/config.local.yaml',
      learner_profile: paths.learner_profile ?? 'docs/learning/learner-profile.yaml',
      concept_registry: paths.concept_registry ?? 'docs/learning/concepts.yaml',
      curriculum: paths.curriculum ?? 'docs/learning/CURRICULUM.md',
      feature_register: paths.feature_register ?? 'docs/learning/feature-register.yaml',
      progress: paths.progress ?? 'docs/learning/progress.json',
      feature_guides: paths.feature_guides ?? 'docs/learning/features',
      review_reports: paths.review_reports ?? 'docs/learning/reviews',
      source_maps: paths.source_maps ?? 'docs/learning/source-maps',
    },
    review: {
      minimum_accuracy_score: Number(getReview('minimum_accuracy_score', 3)),
      minimum_purpose_score: Number(getReview('minimum_purpose_score', 3)),
      minimum_prerequisite_score: Number(getReview('minimum_prerequisite_score', 3)),
      minimum_conceptual_load_score: Number(getReview('minimum_conceptual_load_score', 3)),
      minimum_cause_effect_score: Number(getReview('minimum_cause_effect_score', 3)),
      minimum_other_criterion_score: Number(getReview('minimum_other_criterion_score', 2)),
      minimum_average: Number(getReview('minimum_average', 3.0)),
      max_blocking_findings: Number(getReview('max_blocking_findings', 5)),
      max_full_reference_reads_per_pass: Number(getReview('max_full_reference_reads_per_pass', 12)),
      max_extra_source_inspections_per_pass: Number(getReview('max_extra_source_inspections_per_pass', 5)),
      reference_spot_checks: Number(getReview('reference_spot_checks', 3)),
      require_blocking_findings_to_strictly_decrease: Boolean(
        getReview('require_blocking_findings_to_strictly_decrease', true),
      ),
      allow_severity_weighted_decrease: Boolean(
        getReview('allow_severity_weighted_decrease', true),
      ),
      bind_approval_to_guide_and_evidence_hashes: Boolean(
        getReview('bind_approval_to_guide_and_evidence_hashes', true),
      ),
    },
    progress_states: {
      guide: mergedSections.progress_states?.guide ?? [
        'discovered', 'mapped', 'drafted', 'under_review', 'approved', 'blocked', 'stale',
      ],
      learner: mergedSections.progress_states?.learner ?? [
        'not_taught', 'exposed', 'developing', 'understood', 'needs_revisit',
      ],
    },
  };
}

/* ------------------------------------------- frontmatter & fence tracking */

/**
 * Scan lines and mark which 1-based line numbers are inside YAML frontmatter or fenced code blocks.
 */
export function scanLineContexts(lines) {
  const inFrontmatter = new Set();
  const inCodeFence = new Set();
  const frontmatterLines = [];

  let idx = 0;
  if (lines.length > 0 && lines[0].trim() === '---') {
    inFrontmatter.add(1);
    idx = 1;
    while (idx < lines.length) {
      inFrontmatter.add(idx + 1);
      if (lines[idx].trim() === '---' || lines[idx].trim() === '...') {
        idx += 1;
        break;
      }
      frontmatterLines.push(lines[idx]);
      idx += 1;
    }
  }

  let activeFenceChar = null;
  let activeFenceLen = 0;

  for (let i = idx; i < lines.length; i += 1) {
    const line = lines[i];
    const m = FENCE_PATTERN.exec(line);
    if (m) {
      const fence = m[1];
      const ch = fence[0];
      const len = fence.length;
      if (!activeFenceChar) {
        activeFenceChar = ch;
        activeFenceLen = len;
        inCodeFence.add(i + 1);
        continue;
      } else if (ch === activeFenceChar && len >= activeFenceLen && /^ {0,3}[`~]+\s*$/.test(line)) {
        inCodeFence.add(i + 1);
        activeFenceChar = null;
        activeFenceLen = 0;
        continue;
      }
    }
    if (activeFenceChar) {
      inCodeFence.add(i + 1);
    }
  }

  const frontmatter = frontmatterLines.length
    ? parseSimpleYaml(frontmatterLines.join('\n')).flat
    : {};

  return { inFrontmatter, inCodeFence, frontmatter };
}

/**
 * Compute GitHub-compatible heading slugs (including -1, -2 suffixes for duplicate headings)
 * while ignoring headings inside code fences or frontmatter.
 */
export function headingSlugs(lines) {
  const { inFrontmatter, inCodeFence } = scanLineContexts(lines);
  const slugs = new Set();
  const counts = new Map();

  lines.forEach((line, index) => {
    const lineNum = index + 1;
    if (inFrontmatter.has(lineNum) || inCodeFence.has(lineNum)) return;
    const m = HEADING_PATTERN.exec(line);
    if (!m) return;
    const base = slugify(m[2]);
    if (!base) return;
    const seenCount = counts.get(base) ?? 0;
    const finalSlug = seenCount === 0 ? base : `${base}-${seenCount}`;
    counts.set(base, seenCount + 1);
    slugs.add(finalSlug);
  });

  return slugs;
}

/* --------------------------------------------------- reference extraction */

function parsePathAndLineSuffix(rawTarget) {
  let target = rawTarget;
  let lineStart = null;
  let lineEnd = null;

  // Match :42, :42-58, :42:10 at the end of a path (avoiding Windows C:\ drive letters)
  const colonMatch = /^(.+?):(\d+)(?:-(\d+)|:\d+)?$/.exec(target);
  if (colonMatch && colonMatch[1].length > 1) {
    target = colonMatch[1];
    lineStart = Number(colonMatch[2]);
    lineEnd = colonMatch[3] ? Number(colonMatch[3]) : lineStart;
  }
  return { target, lineStart, lineEnd };
}

function parseAnchorOrLineRange(anchorRaw) {
  if (!anchorRaw) return { anchor: null, lineStart: null, lineEnd: null };
  const lineAnchor = /^L(\d+)(?:-L?(\d+))?$/i.exec(anchorRaw);
  if (lineAnchor) {
    const start = Number(lineAnchor[1]);
    const end = lineAnchor[2] ? Number(lineAnchor[2]) : start;
    return { anchor: null, lineStart: start, lineEnd: end };
  }
  return { anchor: anchorRaw, lineStart: null, lineEnd: null };
}

function isCandidateInlinePath(token) {
  if (!token || /\s/.test(token)) return false;
  if (/^(https?:|mailto:|tel:|www\.|npm:|node:)/i.test(token)) return false;
  if (PATH_EXT_PATTERN.test(token)) return true;
  const base = basename(token.replace(/\/+$/, ''));
  if (EXTENSIONLESS_FILES.has(base)) return true;
  if (DIR_PATH_PATTERN.test(token) && token.endsWith('/')) return true;
  return false;
}

/** Extract candidate references with their line number, layer, symbol, anchor, and line range. */
export function extractReferences(lines, layerSplitLine) {
  const { inFrontmatter, inCodeFence } = scanLineContexts(lines);
  const refs = [];

  const push = (lineNumber, raw, syntax, explicitSymbol = null) => {
    let value = raw.trim();
    if (!value) return;
    if (/^(https?:|mailto:|tel:|www\.)/i.test(value)) return;
    const angle = /^<(.+)>$/.exec(value);
    if (angle) value = angle[1];

    let targetPart = value;
    let rawAnchor = null;
    const hash = /^([^#]*)#(.+)$/.exec(value);
    if (hash) {
      targetPart = hash[1];
      rawAnchor = hash[2];
    } else if (value.startsWith('#')) {
      targetPart = '';
      rawAnchor = value.slice(1);
    }

    const { target, lineStart: colonStart, lineEnd: colonEnd } = parsePathAndLineSuffix(targetPart);
    const { anchor, lineStart: hashStart, lineEnd: hashEnd } = parseAnchorOrLineRange(rawAnchor);

    const lineStart = colonStart ?? hashStart ?? null;
    const lineEnd = colonEnd ?? hashEnd ?? null;

    let symbol = explicitSymbol;
    let finalAnchor = anchor;
    if (!symbol && finalAnchor && target && !target.toLowerCase().endsWith('.md')) {
      // On a non-markdown source file, path#symbolName refers to a symbol
      symbol = finalAnchor;
      finalAnchor = null;
    }

    const layer =
      layerSplitLine && lineNumber >= layerSplitLine ? 'reference' : 'lesson';

    refs.push({
      line: lineNumber,
      layer,
      syntax,
      raw: value,
      target,
      anchor: finalAnchor,
      symbol: symbol ?? null,
      lineStart,
      lineEnd,
    });
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (inFrontmatter.has(lineNumber) || inCodeFence.has(lineNumber)) return;

    for (const m of line.matchAll(LINK_PATTERN)) {
      push(lineNumber, m[1], 'markdown-link');
    }

    for (const m of line.matchAll(CODE_PATTERN)) {
      const fullToken = m[1].trim();
      let token = fullToken;
      let symbol = null;

      if (token.includes('->')) {
        const parts = token.split('->').map((p) => p.trim());
        token = parts[0];
        symbol = parts.slice(1).join('->').trim() || null;
      }

      const strippedForCheck = token
        .replace(/#L\d+(?:-L?\d+)?$/i, '')
        .replace(/:\d+(?:-\d+|:\d+)?$/, '')
        .replace(/#[\w.$-]+$/, '')
        .replace(/\(\)$/, '');

      if (isCandidateInlinePath(strippedForCheck)) {
        const cleanedTarget = token.replace(/\(\)$/, '');
        push(lineNumber, cleanedTarget, 'inline-path', symbol);
      }
    }
  });

  return refs;
}

function resolveTarget(target, guideDir, repoRoot) {
  if (!target) return null;
  const cleaned = target.replace(/\/+$/, '');
  const candidates = [];
  if (isAbsolute(cleaned)) {
    candidates.push(cleaned);
  } else {
    candidates.push(join(guideDir, cleaned));
    candidates.push(join(repoRoot, cleaned));
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        const st = statSync(candidate);
        if (st.isFile()) return { path: resolve(candidate), isDirectory: false };
        if (st.isDirectory()) return { path: resolve(candidate), isDirectory: true };
      }
    } catch {
      /* unreadable candidate: keep looking */
    }
  }
  return null;
}

/**
 * Verify that a symbol exists in a source file and return its 1-based line number if found.
 */
function findSymbolInFile(filePath, rawSymbol) {
  const cleaned = rawSymbol
    .replace(/\([^)]*\)/g, '')
    .replace(/^['"`]|['"`]$/g, '')
    .trim();
  if (!cleaned) return { found: true, line: 1 };

  const parts = cleaned
    .split(/(?:\.|::|->|#)/)
    .map((p) => p.trim())
    .filter(Boolean);
  const primary = parts[parts.length - 1] ?? cleaned;

  const lines = readLines(filePath);
  const tokenRe = new RegExp(`\\b${escapeRe(primary)}\\b`);

  for (let i = 0; i < lines.length; i += 1) {
    if (tokenRe.test(lines[i])) {
      // If a qualifier like ClassName.method was given, also check that ClassName appears in file
      const allPartsPresent = parts.every((part) => {
        const re = new RegExp(`\\b${escapeRe(part)}\\b`);
        return lines.some((l) => re.test(l));
      });
      if (allPartsPresent) {
        return { found: true, line: i + 1, identifier: primary };
      }
    }
  }
  return { found: false, line: null, identifier: primary };
}

/* ------------------------------------------------------------- gate parser */

export function parseGate(reportPath, options = {}) {
  const { config = loadMasteryConfig(null), currentGuideHash = null, currentEvidenceHashes = null } = options;
  const thresholds = config.review;
  const lines = readLines(reportPath);

  const scores = new Map();
  const carriedCriteria = [];
  const rescoredCriteria = [];

  for (const line of lines) {
    // Support both 3-column and 4-column scorecard rows:
    // | 1. Grounded accuracy | 3 | reason |
    // | 1. Grounded accuracy | 3 | carried from iteration 1 | reason |
    const m = /^\|\s*(\d{1,2})\.\s*([^|]+?)\s*\|\s*([0-4])\s*\|\s*([^|]*)\|(?:\s*([^|]*)\|)?/.exec(line);
    if (m) {
      const criterion = Number(m[1]);
      const score = Number(m[3]);
      const col3 = (m[4] ?? '').trim();
      const col4 = (m[5] ?? '').trim();
      scores.set(criterion, score);

      const carriedMatch = /carried(?:\s+from\s+iteration\s+(\d+))?/i.exec(`${col3} ${col4}`);
      if (carriedMatch) {
        carriedCriteria.push({
          criterion,
          score,
          from_iteration: carriedMatch[1] ? Number(carriedMatch[1]) : null,
        });
      } else {
        rescoredCriteria.push(criterion);
      }
    }
  }

  // Also parse prose fallback: "1 -> 3" or "Criterion 1: 3 (carried from iteration 1)"
  for (const line of lines) {
    if (/^\*\*Scores carried forward/i.test(line.trim())) {
      for (const m of line.matchAll(/(?:criterion\s*)?(\d{1,2})\s*(?:->|→|:)\s*([0-4])/gi)) {
        const c = Number(m[1]);
        const s = Number(m[2]);
        if (!scores.has(c)) {
          scores.set(c, s);
          carriedCriteria.push({ criterion: c, score: s, from_iteration: null });
        }
      }
    }
  }

  const hardMinimums = new Map([
    [1, thresholds.minimum_accuracy_score],
    [2, thresholds.minimum_purpose_score],
    [3, thresholds.minimum_prerequisite_score],
    [4, thresholds.minimum_conceptual_load_score],
    [5, thresholds.minimum_cause_effect_score],
  ]);

  const reasons = [];
  const complete = scores.size === 10;

  let sum = 0;
  for (const score of scores.values()) sum += score;
  const average = scores.size ? Math.round((sum / scores.size) * 100) / 100 : 0;

  if (!complete) reasons.push(`scorecard incomplete: ${scores.size} of 10 criteria scored`);
  for (const [criterion, minScore] of hardMinimums.entries()) {
    if (!scores.has(criterion)) reasons.push(`criterion ${criterion} missing`);
    else if (scores.get(criterion) < minScore) {
      reasons.push(`criterion ${criterion} scored ${scores.get(criterion)}, gate requires >=${minScore}`);
    }
  }
  for (let criterion = 1; criterion <= 10; criterion += 1) {
    if (hardMinimums.has(criterion)) continue;
    const minOther = thresholds.minimum_other_criterion_score;
    if (scores.has(criterion) && scores.get(criterion) < minOther) {
      reasons.push(`criterion ${criterion} scored ${scores.get(criterion)}, gate requires >=${minOther}`);
    }
  }
  if (average < thresholds.minimum_average) {
    reasons.push(`average ${average} below ${thresholds.minimum_average}`);
  }

  // Check Guide sha256 binding and Evidence hashes for staleness
  let reportGuideHash = null;
  const reportEvidenceHashes = {};
  let stale = false;
  const staleEvidence = [];

  for (const line of lines) {
    const gh = /^\s*-\s*\*\*Guide\s+(?:sha256|hash):\*\*\s*`?([a-f0-9]{64})`?/i.exec(line);
    if (gh) reportGuideHash = gh[1].toLowerCase();

    const eh = /^\s*(?:-\s*|\|\s*)`?([^\s|`]+\.[\w]+)`?\s*(?:\||:|->|→)\s*`?([a-f0-9]{64})`?/i.exec(line);
    if (eh) {
      reportEvidenceHashes[toPosix(eh[1].trim())] = eh[2].toLowerCase();
    }
  }

  if (reportGuideHash && currentGuideHash && reportGuideHash !== currentGuideHash.toLowerCase()) {
    stale = true;
    reasons.push('guide content changed since review report (sha256 mismatch)');
  }

  if (currentEvidenceHashes && Object.keys(reportEvidenceHashes).length > 0) {
    for (const [relPath, recordedHash] of Object.entries(reportEvidenceHashes)) {
      const currentHash = currentEvidenceHashes[relPath];
      if (!currentHash || currentHash.toLowerCase() !== recordedHash) {
        stale = true;
        staleEvidence.push(relPath);
        reasons.push(`evidence file changed since review: ${relPath}`);
      }
    }
  }

  // Parse revision history to check convergence if multiple iterations exist
  const historyRows = [];
  let inHistory = false;
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      inHistory = /^#{1,6}\s+revision history/i.test(line);
      continue;
    }
    if (!inHistory || !/^\s*\|/.test(line)) continue;
    // | Iteration | Mode | Changes checked | Findings opened | Findings closed | Open blocking | Severity weight | Result |
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length >= 6 && /^\d+$/.test(cells[0])) {
      const iter = Number(cells[0]);
      const openBlocking = /^\d+$/.test(cells[5]) ? Number(cells[5]) : null;
      const severityWeight = cells.length >= 8 && /^\d+$/.test(cells[6]) ? Number(cells[6]) : null;
      if (openBlocking !== null) {
        historyRows.push({ iteration: iter, open_blocking: openBlocking, severity_weight: severityWeight });
      }
    }
  }

  let convergenceOk = true;
  if (thresholds.require_blocking_findings_to_strictly_decrease && historyRows.length >= 2) {
    for (let i = 1; i < historyRows.length; i += 1) {
      const prev = historyRows[i - 1];
      const curr = historyRows[i];
      const countDecreased = curr.open_blocking < prev.open_blocking;
      const weightDecreased =
        thresholds.allow_severity_weighted_decrease &&
        prev.severity_weight !== null &&
        curr.severity_weight !== null &&
        curr.severity_weight < prev.severity_weight;
      if (!countDecreased && !weightDecreased && !(prev.open_blocking === 0 && curr.open_blocking === 0)) {
        convergenceOk = false;
        reasons.push(
          `revision iteration ${curr.iteration} did not reduce open blocking findings (${prev.open_blocking} -> ${curr.open_blocking}) or severity-weighted total`,
        );
      }
    }
  }

  return {
    scores_complete: complete,
    scores: [...scores.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([criterion, score]) => ({ criterion, score })),
    carried_criteria: carriedCriteria,
    rescored_criteria: rescoredCriteria,
    average,
    stale,
    stale_evidence: staleEvidence,
    guide_sha256_in_report: reportGuideHash,
    convergence_ok: convergenceOk,
    passes: reasons.length === 0,
    reasons,
  };
}

/* ------------------------------------------- concepts & jargon validation */

function collectPriorIntroducedConcepts(guideFull, repoRoot, config, currentOrder) {
  const introduced = new Set();
  const futureConcepts = new Map(); // concept -> unit_id

  // 1. Check learner-profile.yaml known_concepts
  const profilePaths = [
    join(repoRoot, config.paths.learner_profile),
    join(repoRoot, '.adaptive-mastery', 'config', 'learner-profile.yaml'),
    join(repoRoot, 'config', 'learner-profile.yaml'),
  ];
  for (const p of profilePaths) {
    if (existsSync(p)) {
      const parsed = parseSimpleYaml(readFileSync(p, 'utf8')).flat;
      if (Array.isArray(parsed.known_concepts)) {
        for (const c of parsed.known_concepts) introduced.add(String(c).toLowerCase());
      }
    }
  }

  // 2. Check concepts.yaml if present
  const conceptsPath = join(repoRoot, config.paths.concept_registry);
  if (existsSync(conceptsPath)) {
    const parsed = parseSimpleYaml(readFileSync(conceptsPath, 'utf8'));
    if (Array.isArray(parsed.flat.known_concepts)) {
      for (const c of parsed.flat.known_concepts) introduced.add(String(c).toLowerCase());
    }
  }

  // 3. Scan sibling guides in the same directory
  const guideDir = dirname(guideFull);
  try {
    const entries = readdirSync(guideDir).filter((f) => f.endsWith('.md'));
    for (const entry of entries) {
      const full = resolve(guideDir, entry);
      if (full === guideFull) continue;
      const lines = readLines(full);
      const { frontmatter } = scanLineContexts(lines);
      const numPrefix = /^(\d+)/.exec(entry);
      const order =
        typeof frontmatter.unit_order === 'number'
          ? frontmatter.unit_order
          : (numPrefix ? Number(numPrefix[1]) : null);

      const unitIntroduces = Array.isArray(frontmatter.introduces) ? frontmatter.introduces : [];
      if (order !== null && currentOrder !== null) {
        if (order < currentOrder) {
          for (const c of unitIntroduces) introduced.add(String(c).toLowerCase());
        } else if (order > currentOrder) {
          for (const c of unitIntroduces) {
            futureConcepts.set(String(c).toLowerCase(), frontmatter.unit_id ?? entry);
          }
        }
      }
    }
  } catch {
    /* ignore directory scan errors */
  }

  return { introduced, futureConcepts };
}

function checkConceptsAndJargon({ lines, headings, inFrontmatter, inCodeFence, frontmatter, guideFull, repoRoot, config }) {
  const numPrefix = /^(\d+)/.exec(basename(guideFull));
  const currentOrder =
    typeof frontmatter.unit_order === 'number'
      ? frontmatter.unit_order
      : (numPrefix ? Number(numPrefix[1]) : null);

  const introduces = (Array.isArray(frontmatter.introduces) ? frontmatter.introduces : []).map((c) =>
    String(c).trim(),
  );
  const assumes = (Array.isArray(frontmatter.assumes) ? frontmatter.assumes : []).map((c) =>
    String(c).trim(),
  );

  const { introduced: priorIntroduced, futureConcepts } = collectPriorIntroducedConcepts(
    guideFull,
    repoRoot,
    config,
    currentOrder,
  );

  const missingPrerequisites = [];
  if (assumes.length > 0 && currentOrder !== null) {
    for (const req of assumes) {
      if (!priorIntroduced.has(req.toLowerCase())) {
        missingPrerequisites.push({
          concept: req,
          reason: `assumed concept "${req}" is not introduced by any earlier unit or learner profile`,
        });
      }
    }
  }

  // Locate the opening section ("What this helps the user do") line range
  const topHeadings = headings.filter((h) => h.level <= 2);
  const openingIdx = topHeadings.findIndex((h) =>
    h.title.toLowerCase().includes('what this helps the user do'),
  );
  const prematureJargon = [];

  if (openingIdx !== -1) {
    const startLine = topHeadings[openingIdx].line + 1;
    const endLine =
      openingIdx + 1 < topHeadings.length ? topHeadings[openingIdx + 1].line - 1 : lines.length;

    const openingTextLines = [];
    for (let ln = startLine; ln <= endLine; ln += 1) {
      if (!inFrontmatter.has(ln) && !inCodeFence.has(ln)) {
        openingTextLines.push({ line: ln, text: lines[ln - 1] });
      }
    }

    const assumedLower = new Set(assumes.map((a) => a.toLowerCase()));
    const watchlistHits = [];

    for (const { line, text } of openingTextLines) {
      // 1. Any term in `introduces` used in the very first section before need/mental model
      for (const term of introduces) {
        if (assumedLower.has(term.toLowerCase())) continue;
        const re = new RegExp(`\\b${escapeRe(term)}\\b`, 'i');
        if (re.test(text)) {
          prematureJargon.push({
            line,
            term,
            reason: `newly introduced concept "${term}" appears in the opening section before its problem/need is established`,
          });
        }
      }

      // 2. Default jargon watchlist terms stacked in the opening section
      for (const term of DEFAULT_JARGON_WATCHLIST) {
        if (assumedLower.has(term.toLowerCase()) || priorIntroduced.has(term.toLowerCase())) continue;
        const re = new RegExp(`\\b${escapeRe(term)}\\b`, 'i');
        if (re.test(text)) {
          watchlistHits.push({ line, term });
        }
      }
    }

    // Also check if the H1/H2 title before the mental model stacks unexplained jargon
    for (const h of headings) {
      if (h.line <= endLine) {
        for (const term of DEFAULT_JARGON_WATCHLIST) {
          if (assumedLower.has(term.toLowerCase()) || priorIntroduced.has(term.toLowerCase())) continue;
          const re = new RegExp(`\\b${escapeRe(term)}\\b`, 'i');
          if (re.test(h.title)) {
            watchlistHits.push({ line: h.line, term });
          }
        }
      }
    }

    const distinctWatchlistTerms = new Set(watchlistHits.map((h) => h.term.toLowerCase()));
    if (distinctWatchlistTerms.size >= 3) {
      const seenTerms = new Set();
      for (const hit of watchlistHits) {
        const key = hit.term.toLowerCase();
        if (seenTerms.has(key)) continue;
        seenTerms.add(key);
        prematureJargon.push({
          line: hit.line,
          term: hit.term,
          reason: `unexplained technical jargon "${hit.term}" stacked in opening before establishing need`,
        });
      }
    }
  }

  // 3. Check if any concept introduced only by a LATER unit is used in the lesson layer
  if (futureConcepts.size > 0) {
    const allowedLower = new Set([
      ...assumes.map((a) => a.toLowerCase()),
      ...introduces.map((i) => i.toLowerCase()),
      ...priorIntroduced,
    ]);
    const lessonEnd =
      topHeadings.find((h) => /^technical reference/i.test(h.title))?.line ?? lines.length;
    for (let ln = 1; ln < lessonEnd; ln += 1) {
      if (inFrontmatter.has(ln) || inCodeFence.has(ln)) continue;
      const text = lines[ln - 1];
      for (const [futureTerm, ownerUnit] of futureConcepts.entries()) {
        if (allowedLower.has(futureTerm)) continue;
        const re = new RegExp(`\\b${escapeRe(futureTerm)}\\b`, 'i');
        if (re.test(text)) {
          prematureJargon.push({
            line: ln,
            term: futureTerm,
            reason: `concept "${futureTerm}" is introduced in later unit (${ownerUnit}) and is not declared in assumes/introduces`,
          });
        }
      }
    }
  }

  return {
    unit_id: frontmatter.unit_id ?? null,
    unit_order: currentOrder,
    introduces,
    assumes,
    missing_prerequisites: missingPrerequisites,
    premature_jargon: prematureJargon,
  };
}

/* ---------------------------------------------------------- evidence pack */

function buildEvidencePack(resolvedRefs, root) {
  const pack = [];
  for (const item of resolvedRefs) {
    if (item.kind === 'anchor' || item.kind === 'directory') continue;
    const absPath = resolve(root, item.path);
    if (!existsSync(absPath)) continue;
    const fileLines = readLines(absPath);
    let startLine = 1;
    let endLine = Math.min(fileLines.length, 35);

    if (item.line_start) {
      startLine = Math.max(1, item.line_start - 3);
      endLine = Math.min(fileLines.length, (item.line_end ?? item.line_start) + 15);
    } else if (item.symbol_line) {
      startLine = Math.max(1, item.symbol_line - 2);
      endLine = Math.min(fileLines.length, item.symbol_line + 25);
    } else if (item.anchor && absPath.endsWith('.md')) {
      const targetSlug = slugify(item.anchor);
      const { inFrontmatter, inCodeFence } = scanLineContexts(fileLines);
      const counts = new Map();
      for (let i = 0; i < fileLines.length; i += 1) {
        const ln = i + 1;
        if (inFrontmatter.has(ln) || inCodeFence.has(ln)) continue;
        const m = HEADING_PATTERN.exec(fileLines[i]);
        if (!m) continue;
        const base = slugify(m[2]);
        const c = counts.get(base) ?? 0;
        const slug = c === 0 ? base : `${base}-${c}`;
        counts.set(base, c + 1);
        if (slug === targetSlug) {
          startLine = ln;
          endLine = Math.min(fileLines.length, ln + 30);
          break;
        }
      }
    }

    const excerpt = fileLines.slice(startLine - 1, endLine).join('\n');
    pack.push({
      path: item.path,
      layer: item.layer,
      raw: item.raw,
      symbol: item.symbol ?? null,
      anchor: item.anchor ?? null,
      start_line: startLine,
      end_line: endLine,
      sha256: sha256FileNormalized(absPath),
      excerpt,
    });
  }
  return pack;
}

export function formatEvidencePackMarkdown(summary, pack) {
  const out = [
    `# Evidence Pack — ${summary.guide}`,
    '',
    `- **Guide sha256:** \`${summary.guide_sha256}\``,
    `- **Generated at:** ${summary.checked_at}`,
    `- **Excerpts inlined:** ${pack.length}`,
    '',
  ];
  for (const item of pack) {
    const label = [
      `\`${item.path}\``,
      item.symbol ? `symbol \`${item.symbol}\`` : null,
      item.anchor ? `anchor \`#${item.anchor}\`` : null,
      `lines ${item.start_line}–${item.end_line}`,
    ]
      .filter(Boolean)
      .join(' · ');
    out.push(`## ${label}`);
    out.push(`- **Layer:** ${item.layer}`);
    out.push(`- **Reference:** \`${item.raw}\``);
    out.push(`- **File sha256:** \`${item.sha256}\``);
    out.push('');
    out.push('```');
    out.push(item.excerpt);
    out.push('```');
    out.push('');
  }
  return out.join('\n');
}

/* ----------------------------------------------------------- analyzeGuide */

/**
 * Analyze one guide.
 * @returns {{summary: object, blocking: boolean}}
 */
export function analyzeGuide({ guidePath, repoRoot, reviewReport, emitPack = false }) {
  const guideFull = resolve(guidePath);
  if (!existsSync(guideFull)) {
    const error = new Error(`guide not found: ${guidePath}`);
    error.code = 'ENOENT_GUIDE';
    throw error;
  }
  const guideDir = dirname(guideFull);
  const root = resolve(repoRoot ?? findRepoRoot(guideDir) ?? guideDir);
  const config = loadMasteryConfig(root);

  const lines = readLines(guideFull);
  const guideSha256 = sha256FileNormalized(guideFull);
  const { inFrontmatter, inCodeFence, frontmatter } = scanLineContexts(lines);

  const headings = [];
  let layerSplitLine = null;
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    if (inFrontmatter.has(lineNum) || inCodeFence.has(lineNum)) return;
    const m = HEADING_PATTERN.exec(line);
    if (!m) return;
    const level = m[1].length;
    const title = m[2];
    headings.push({ line: lineNum, level, title });
    if (level <= 2 && /^technical reference/i.test(title) && layerSplitLine === null) {
      layerSplitLine = lineNum;
    }
  });

  const topHeadings = headings.filter((h) => h.level <= 2);
  const topLevelTitles = topHeadings.map((h) => h.title.toLowerCase());
  const missingSections = REQUIRED_SECTIONS.filter(
    (required) => !topLevelTitles.some((title) => title.includes(required)),
  );

  // Check required sections for empty or trivial placeholder content
  const emptyOrPlaceholderSections = [];
  for (const required of REQUIRED_SECTIONS) {
    const idx = topHeadings.findIndex((h) => h.title.toLowerCase().includes(required));
    if (idx === -1) continue;
    const startLine = topHeadings[idx].line + 1;
    const endLine = idx + 1 < topHeadings.length ? topHeadings[idx + 1].line - 1 : lines.length;
    const bodyText = lines
      .slice(startLine - 1, endLine)
      .join('\n')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();

    if (!bodyText || PLACEHOLDER_BODY_PATTERN.test(bodyText)) {
      emptyOrPlaceholderSections.push(required);
    }
  }

  const guideSlugs = headingSlugs(lines);
  const refs = extractReferences(lines, layerSplitLine);

  const resolved = [];
  const missing = [];
  const brokenAnchors = [];
  const missingSymbols = [];
  const evidenceHashes = {};
  const seen = new Set();

  for (const ref of refs) {
    const key = `${ref.layer}|${ref.target}|${ref.anchor ?? ''}|${ref.symbol ?? ''}|${ref.lineStart ?? ''}-${ref.lineEnd ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!ref.target) {
      if (guideSlugs.has(slugify(ref.anchor))) {
        resolved.push({
          line: ref.line,
          layer: ref.layer,
          raw: ref.raw,
          kind: 'anchor',
          anchor: ref.anchor,
          path: toPosix(relative(root, guideFull)),
        });
      } else {
        brokenAnchors.push({
          line: ref.line,
          layer: ref.layer,
          raw: ref.raw,
          anchor: ref.anchor,
          reason: 'no matching heading in this guide',
        });
      }
      continue;
    }

    const resolvedTarget = resolveTarget(ref.target, guideDir, root);
    if (!resolvedTarget) {
      missing.push({
        line: ref.line,
        layer: ref.layer,
        raw: ref.raw,
        target: ref.target,
        reason: 'path does not exist from guide directory or repository root',
      });
      continue;
    }

    const targetPath = resolvedTarget.path;
    const relTargetPath = toPosix(relative(root, targetPath));

    if (resolvedTarget.isDirectory) {
      resolved.push({
        line: ref.line,
        layer: ref.layer,
        raw: ref.raw,
        kind: 'directory',
        path: relTargetPath,
      });
      continue;
    }

    evidenceHashes[relTargetPath] = sha256FileNormalized(targetPath);

    // Check line range bounds if specified
    if (ref.lineStart !== null) {
      const targetLines = readLines(targetPath);
      const maxLine = targetLines.length;
      if (ref.lineStart < 1 || ref.lineStart > maxLine || (ref.lineEnd && ref.lineEnd > maxLine)) {
        brokenAnchors.push({
          line: ref.line,
          layer: ref.layer,
          raw: ref.raw,
          anchor: `${ref.lineStart}${ref.lineEnd && ref.lineEnd !== ref.lineStart ? `-${ref.lineEnd}` : ''}`,
          reason: `line reference out of range in ${relTargetPath} (file has ${maxLine} lines)`,
        });
        continue;
      }
    }

    // Check markdown heading anchors
    if (ref.anchor && targetPath.endsWith('.md')) {
      const targetSlugs = headingSlugs(readLines(targetPath));
      if (!targetSlugs.has(slugify(ref.anchor))) {
        brokenAnchors.push({
          line: ref.line,
          layer: ref.layer,
          raw: ref.raw,
          anchor: ref.anchor,
          reason: `heading not found in ${relTargetPath}`,
        });
        continue;
      }
    }

    // Check symbol existence in target file
    let symbolLine = null;
    if (ref.symbol) {
      const symResult = findSymbolInFile(targetPath, ref.symbol);
      if (!symResult.found) {
        const symDefect = {
          line: ref.line,
          layer: ref.layer,
          raw: ref.raw,
          target: relTargetPath,
          symbol: ref.symbol,
          reason: `symbol "${symResult.identifier}" not found in ${relTargetPath}`,
        };
        missingSymbols.push(symDefect);
        brokenAnchors.push({
          line: ref.line,
          layer: ref.layer,
          raw: ref.raw,
          anchor: ref.symbol,
          reason: symDefect.reason,
        });
        continue;
      }
      symbolLine = symResult.line;
    }

    resolved.push({
      line: ref.line,
      layer: ref.layer,
      raw: ref.raw,
      kind: targetPath.endsWith('.md') ? 'document' : 'source',
      path: relTargetPath,
      anchor: ref.anchor ?? null,
      symbol: ref.symbol ?? null,
      symbol_line: symbolLine,
      line_start: ref.lineStart,
      line_end: ref.lineEnd,
    });
  }

  let evidenceRows = 0;
  let inEvidence = false;
  lines.forEach((line, index) => {
    const lineNum = index + 1;
    if (inFrontmatter.has(lineNum) || inCodeFence.has(lineNum)) return;
    if (/^#{1,6}\s+/.test(line)) {
      inEvidence = /^#{1,6}\s+evidence and confidence/i.test(line);
      return;
    }
    if (!inEvidence || !/^\s*\|/.test(line)) return;
    if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) return;
    if (/^\s*\|\s*claim\s*\|/i.test(line)) return;
    if (line.trim().length > 3) evidenceRows += 1;
  });

  const concepts = checkConceptsAndJargon({
    lines,
    headings,
    inFrontmatter,
    inCodeFence,
    frontmatter,
    guideFull,
    repoRoot: root,
    config,
  });

  const gate = reviewReport
    ? parseGate(resolve(reviewReport), {
        config,
        currentGuideHash: guideSha256,
        currentEvidenceHashes: evidenceHashes,
      })
    : null;

  const blocking =
    missingSections.length +
      emptyOrPlaceholderSections.length +
      missing.length +
      brokenAnchors.length +
      missingSymbols.length +
      concepts.missing_prerequisites.length +
      concepts.premature_jargon.length >
      0 || Boolean(gate && gate.stale);

  const evidencePack = emitPack ? buildEvidencePack(resolved, root) : undefined;

  const summary = {
    guide: toPosix(relative(root, guideFull)),
    guide_sha256: guideSha256,
    repo_root: toPosix(root),
    layer_split_line: layerSplitLine,
    sections: {
      found: topHeadings.map((h) => h.title),
      missing: missingSections,
      empty_or_placeholder: emptyOrPlaceholderSections,
    },
    references: {
      resolved_lesson: resolved.filter((r) => r.layer === 'lesson').length,
      resolved_reference: resolved.filter((r) => r.layer === 'reference').length,
      missing,
      broken_anchors: brokenAnchors,
      missing_symbols: missingSymbols,
    },
    concepts,
    evidence_rows: evidenceRows,
    evidence_hashes: evidenceHashes,
    gate,
    stale: gate ? gate.stale : false,
    ...(evidencePack ? { evidence_pack: evidencePack } : {}),
    blocking_problems: blocking,
    checked_at: new Date().toISOString(),
  };

  return { summary, blocking, evidencePack };
}

/* ------------------------------------------- state & coverage validation */

function parseFeatureRegisterYaml(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const repository = {};
  const features = [];
  let inRepo = false;
  let inFeatures = false;
  let currentFeature = null;
  let currentListProp = null;

  for (const rawLine of lines) {
    const cleaned = stripInlineComment(rawLine);
    if (!cleaned.trim() || cleaned.trim().startsWith('#')) continue;
    const indent = rawLine.match(/^ */)[0].length;
    const trimmed = cleaned.trim();

    if (indent === 0 && trimmed === 'repository:') {
      inRepo = true;
      inFeatures = false;
      continue;
    }
    if (indent === 0 && trimmed === 'features:') {
      inRepo = false;
      inFeatures = true;
      continue;
    }

    if (inRepo && indent > 0) {
      const kv = /^([\w.-]+)\s*:\s*(.*)$/.exec(trimmed);
      if (kv) repository[kv[1]] = parseScalar(kv[2]);
      continue;
    }

    if (inFeatures) {
      if (trimmed.startsWith('- ')) {
        const afterDash = trimmed.slice(2).trim();
        const kv = /^([\w.-]+)\s*:\s*(.*)$/.exec(afterDash);
        if (indent <= 4 && kv) {
          currentFeature = { [kv[1]]: parseScalar(kv[2]) };
          features.push(currentFeature);
          currentListProp = null;
          continue;
        }
        if (currentFeature && currentListProp) {
          if (!Array.isArray(currentFeature[currentListProp])) {
            currentFeature[currentListProp] = [];
          }
          currentFeature[currentListProp].push(parseScalar(afterDash));
          continue;
        }
      }
      if (currentFeature) {
        const kv = /^([\w.-]+)\s*:\s*(.*)$/.exec(trimmed);
        if (kv) {
          const [, k, v] = kv;
          if (v === '') {
            currentListProp = k;
            currentFeature[k] = [];
          } else {
            currentListProp = null;
            currentFeature[k] = parseScalar(v);
          }
        }
      }
    }
  }
  return { repository, features };
}

function listRepositorySourceFiles(repoRoot) {
  // Prefer git ls-files when inside a git worktree; fall back to walking the tree
  try {
    const out = execFileSync('git', ['ls-files'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const files = out
      .split(/\r?\n/)
      .map((f) => toPosix(f.trim()))
      .filter(Boolean);
    if (files.length > 0) return files;
  } catch {
    /* not a git repo or git unavailable; fall back to directory walk */
  }

  const ignoredDirs = new Set([
    '.git', 'node_modules', '.adaptive-mastery', 'dist', 'build', 'coverage', '.next', '.tmp',
  ]);
  const results = [];
  const walkDir = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignoredDirs.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (entry.isFile()) results.push(toPosix(relative(repoRoot, full)));
    }
  };
  walkDir(repoRoot);
  return results.sort();
}

/**
 * Validate `progress.json`, `feature-register.yaml`, guide staleness, and mechanical file coverage.
 */
export function validateRepositoryState({ repoRoot }) {
  const root = resolve(repoRoot ?? process.cwd());
  const config = loadMasteryConfig(root);
  const problems = [];
  const warnings = [];

  const progressPath = join(root, config.paths.progress);
  const registerPath = join(root, config.paths.feature_register);

  let progressValid = null;
  let registerValid = null;
  let coverageReport = null;
  const staleUnits = [];

  if (existsSync(progressPath)) {
    try {
      const data = JSON.parse(readFileSync(progressPath, 'utf8'));
      const requiredTopKeys = [
        'schema_version',
        'repository',
        'coverage',
        'curriculum',
        'learner_model',
        'session_checkpoint',
        'review_loop',
      ];
      for (const k of requiredTopKeys) {
        if (!(k in data) || typeof data[k] !== 'object' || data[k] === null) {
          if (k === 'schema_version' && typeof data[k] === 'string') continue;
          problems.push(`progress.json: missing or invalid top-level field "${k}"`);
        }
      }
      const validInvStatuses = ['not_started', 'partial', 'reconciled', 'lazy'];
      if (
        data.coverage?.inventory_status &&
        !validInvStatuses.includes(data.coverage.inventory_status)
      ) {
        problems.push(
          `progress.json: invalid coverage.inventory_status "${data.coverage.inventory_status}"`,
        );
      }
      progressValid = problems.filter((p) => p.startsWith('progress.json:')).length === 0;
    } catch (err) {
      problems.push(`progress.json: invalid JSON (${err.message})`);
      progressValid = false;
    }
  }

  if (existsSync(registerPath)) {
    try {
      const { repository, features } = parseFeatureRegisterYaml(readFileSync(registerPath, 'utf8'));
      if (!repository.name) {
        problems.push('feature-register.yaml: missing repository.name');
      }
      if (!Array.isArray(features) || features.length === 0) {
        problems.push('feature-register.yaml: features list is empty or missing');
      }

      const validSourceStatus = ['not_inspected', 'partially_mapped', 'mapped', 'blocked', 'out_of_scope'];
      const validReviewStatus = [
        'not_started', 'draft', 'drafted', 'under_review', 'approved', 'blocked', 'stale',
      ];
      const validLearningStatus = config.progress_states.learner;
      const citedPaths = new Set();

      for (const feat of features) {
        const id = feat.id ?? '(unnamed)';
        if (!feat.id || String(feat.id).startsWith('[')) {
          problems.push(`feature-register.yaml: feature "${id}" has unpopulated template id`);
        }
        if (feat.source_status && !validSourceStatus.includes(feat.source_status)) {
          problems.push(`feature-register.yaml: feature "${id}" has invalid source_status "${feat.source_status}"`);
        }
        if (feat.review_status && !validReviewStatus.includes(feat.review_status)) {
          problems.push(`feature-register.yaml: feature "${id}" has invalid review_status "${feat.review_status}"`);
        }
        if (feat.learning_status && !validLearningStatus.includes(feat.learning_status)) {
          problems.push(`feature-register.yaml: feature "${id}" has invalid learning_status "${feat.learning_status}"`);
        }

        const pathsToCheck = [
          ...(Array.isArray(feat.evidence_paths) ? feat.evidence_paths : []),
          ...(Array.isArray(feat.entry_points) ? feat.entry_points : []),
        ];
        for (const p of pathsToCheck) {
          const cleanPath = String(p).split('->')[0].split(':')[0].split('#')[0].trim();
          if (!cleanPath) continue;
          citedPaths.add(toPosix(cleanPath));
          if (!existsSync(join(root, cleanPath))) {
            problems.push(`feature-register.yaml: feature "${id}" cites missing path "${cleanPath}"`);
          }
        }

        if (feat.guide_path && !existsSync(join(root, String(feat.guide_path)))) {
          problems.push(`feature-register.yaml: feature "${id}" cites missing guide_path "${feat.guide_path}"`);
        }
        if (feat.review_path && !existsSync(join(root, String(feat.review_path)))) {
          problems.push(`feature-register.yaml: feature "${id}" cites missing review_path "${feat.review_path}"`);
        }

        if (
          feat.review_status === 'approved' &&
          feat.guide_path &&
          feat.review_path &&
          existsSync(join(root, String(feat.guide_path))) &&
          existsSync(join(root, String(feat.review_path)))
        ) {
          const analysis = analyzeGuide({
            guidePath: join(root, String(feat.guide_path)),
            repoRoot: root,
            reviewReport: join(root, String(feat.review_path)),
          });
          if (analysis.summary.stale) {
            staleUnits.push(id);
            problems.push(
              `feature-register.yaml: feature "${id}" is marked approved but its guide or evidence is stale`,
            );
          }
        }
      }

      // Compute mechanical coverage against repository source files
      const learningRootPrefix = `${toPosix(config.paths.learning_root)}/`;
      const allFiles = listRepositorySourceFiles(root).filter((f) => {
        if (f.startsWith('.adaptive-mastery/') || f.startsWith(learningRootPrefix)) return false;
        if (f.startsWith('.git/') || f.startsWith('.github/')) return false;
        const ext = f.includes('.') ? f.split('.').pop().toLowerCase() : '';
        if (['md', 'txt', 'json', 'lock', 'gitignore', 'gitattributes'].includes(ext)) return false;
        return SOURCE_EXTENSIONS.includes(ext) || EXTENSIONLESS_FILES.has(basename(f));
      });

      const uncited = allFiles.filter((file) => {
        if (citedPaths.has(file)) return false;
        for (const cited of citedPaths) {
          if (file.startsWith(`${cited.replace(/\/+$/, '')}/`)) return false;
        }
        return true;
      });

      const citedCount = allFiles.length - uncited.length;
      coverageReport = {
        total_source_files: allFiles.length,
        cited_source_files: citedCount,
        coverage_ratio:
          allFiles.length === 0 ? 1 : Math.round((citedCount / allFiles.length) * 1000) / 1000,
        uncited_files: uncited,
      };

      registerValid = problems.filter((p) => p.startsWith('feature-register.yaml:')).length === 0;
    } catch (err) {
      problems.push(`feature-register.yaml: parse error (${err.message})`);
      registerValid = false;
    }
  }

  if (progressValid === null && registerValid === null) {
    warnings.push(
      `neither ${config.paths.progress} nor ${config.paths.feature_register} exists yet`,
    );
  }

  return {
    ok: problems.length === 0,
    repo_root: toPosix(root),
    progress_valid: progressValid,
    feature_register_valid: registerValid,
    stale_units: staleUnits,
    coverage: coverageReport,
    problems,
    warnings,
  };
}

/* --------------------------------------------------------------------- CLI */

const USAGE = `Preflight a feature guide before review.

Usage
  adaptive-mastery preflight <guide.md> [options]
  node tools/preflight-review.mjs <guide.md> [options]

Options
  --repo-root <dir>       Repository root for resolving references. Default: nearest .git
  --review-report <file>  Recompute the approval gate and staleness from a review report
  --emit-pack [<file>]    Resolve and inline reference excerpts (writes to <file> if given)
  --out <file>            Also write the JSON result here
  --help                  Show this message

Exit codes: 0 clean, 1 blocking problem, 2 usage/input error.
`;

export function main(argv = process.argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }

  let guidePath = null;
  let repoRoot = null;
  let reviewReport = null;
  let outFile = null;
  let emitPack = false;
  let packFile = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--repo-root') repoRoot = args[++i];
    else if (arg === '--review-report') reviewReport = args[++i];
    else if (arg === '--out') outFile = args[++i];
    else if (arg === '--emit-pack') {
      emitPack = true;
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        packFile = args[++i];
      }
    } else if (arg.startsWith('--emit-pack=')) {
      emitPack = true;
      packFile = arg.slice('--emit-pack='.length);
    } else if (arg.startsWith('--')) {
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
    result = analyzeGuide({ guidePath, repoRoot, reviewReport, emitPack });
  } catch (error) {
    process.stderr.write(`preflight: ${error.message}\n`);
    return 2;
  }

  if (packFile && result.evidencePack) {
    const resolvedPack = resolve(packFile);
    mkdirSync(dirname(resolvedPack), { recursive: true });
    if (resolvedPack.endsWith('.md')) {
      writeFileSync(resolvedPack, formatEvidencePackMarkdown(result.summary, result.evidencePack));
    } else {
      writeFileSync(resolvedPack, `${JSON.stringify(result.evidencePack, null, 2)}\n`);
    }
  }

  const json = JSON.stringify(result.summary, null, 2);
  process.stdout.write(`${json}\n`);
  if (outFile) {
    mkdirSync(dirname(resolve(outFile)), { recursive: true });
    writeFileSync(resolve(outFile), json);
  }
  return result.blocking ? 1 : 0;
}

function isDirectInvocation() {
  if (!process.argv[1]) return false;
  try {
    const a = realpathSync(process.argv[1]);
    const b = realpathSync(THIS_FILE);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    const a = resolve(process.argv[1]);
    const b = resolve(THIS_FILE);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
}

if (isDirectInvocation()) {
  process.exitCode = main(process.argv);
}
