#!/usr/bin/env node
/**
 * Stage 0 review preflight, calibration verifier, and learning-state validator:
 * deterministic checks that must never consume a reviewer pass.
 *
 * Resolves every learner-facing reference in a feature guide (including path:line, path#L10,
 * path -> symbol() outside comments/strings, and extensionless files like Makefile; rejects vague
 * directory links), validates same-document and cross-document anchors (with GitHub -1/-2 duplicate
 * slugs), tracks code fences, requires YAML frontmatter (unit_id, unit_order, introduces, assumes),
 * compares required sections against templates/feature-guide-template.md to catch unedited template
 * prose, requires at least one populated evidence row, verifies concept prerequisites and premature
 * jargon, computes self-reference-safe guide SHA-256 and region-aware evidence hashes for hard/soft
 * staleness detection, emits an inlined evidence pack (--emit-pack), and recomputes the approval
 * gate and open finding counts from ### [F-xx] blocks.
 *
 * Prints one JSON object on stdout. No network access, no repository mutation (except --out / --emit-pack / calibrate --record), no code execution.
 *
 * Exit codes: 0 = clean, 1 = blocking problem, 2 = usage or input error.
 */
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync, realpathSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative, isAbsolute, sep, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkNovicePlainness } from './novice-lint.mjs';

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

const DEFAULT_COVERAGE_IGNORE_GLOBS = [
  '**/*.d.ts',
  '**/*.snap',
  '**/__snapshots__/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.generated.*',
  '**/generated/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.next/**',
  '**/node_modules/**',
];

const PATH_EXT_PATTERN = new RegExp(`^[\\w.\\-/\\\\@]+\\.(${SOURCE_EXTENSIONS.join('|')})$`);
const DIR_PATH_PATTERN = /^[\w.\-@]+(?:[/\\][\w.\-@]*)*\/$/;
const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const CODE_PATTERN = /`([^`]+)`/g;
const HEADING_PATTERN = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const PLACEHOLDER_BODY_PATTERN = /^(?:placeholder|todo|tbd|n\/a|none|coming soon|fill me in|\.\.\.|…|\[[\s\S]*\]|<(?:placeholder|todo|tbd)>)$/i;

/**
 * Header metadata lines stripped before hashing a guide so updating status, review record,
 * or Guide sha256 inside a guide never invalidates its own content hash.
 */
const SELF_REF_HEADER_LINE_RE =
  /^>\s*\*\*(?:Guide\s+(?:status|sha256|hash)|Last\s+source\s+verification|Review\s+record)\s*:\*\*.*$/i;

/** Normalize CRLF -> LF and compute SHA-256 hex digest. */
export function sha256Normalized(content) {
  const text = typeof content === 'string' ? content : content.toString('utf8');
  return createHash('sha256').update(text.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export function sha256FileNormalized(filePath) {
  return sha256Normalized(readFileSync(filePath, 'utf8'));
}

/**
 * Compute the canonical SHA-256 of a feature guide after stripping mutable header metadata lines
 * (`Guide status`, `Guide sha256`, `Last source verification`, `Review record`).
 */
export function computeGuideSha256(content) {
  const text = (typeof content === 'string' ? content : content.toString('utf8')).replace(/\r\n/g, '\n');
  const filtered = text
    .split('\n')
    .filter((line) => !SELF_REF_HEADER_LINE_RE.test(line.trim()))
    .join('\n');
  return sha256Normalized(filtered);
}

export function computeGuideFileSha256(filePath) {
  return computeGuideSha256(readFileSync(filePath, 'utf8'));
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
  const coverage = mergedSections.coverage ?? {};
  const bootstrap = mergedSections.bootstrap ?? {};
  const novice = mergedSections.novice ?? {};
  const getReview = (key, fallback) =>
    review[key] !== undefined ? review[key] : (mergedFlat[key] !== undefined ? mergedFlat[key] : fallback);
  const getCoverage = (key, fallback) =>
    coverage[key] !== undefined ? coverage[key] : (mergedFlat[key] !== undefined ? mergedFlat[key] : fallback);
  const getNovice = (key, fallback) =>
    novice[key] !== undefined ? novice[key] : (mergedFlat[key] !== undefined ? mergedFlat[key] : fallback);

  return {
    loadedFrom,
    bootstrap: {
      default_mode: bootstrap.default_mode ?? mergedFlat.default_mode ?? 'lazy',
      require_mechanical_coverage_report: Boolean(
        bootstrap.require_mechanical_coverage_report ?? mergedFlat.require_mechanical_coverage_report ?? true,
      ),
    },
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
    coverage: {
      ignore_globs: Array.isArray(getCoverage('ignore_globs', null))
        ? getCoverage('ignore_globs', DEFAULT_COVERAGE_IGNORE_GLOBS)
        : DEFAULT_COVERAGE_IGNORE_GLOBS,
      minimum_coverage_ratio: Number(getCoverage('minimum_coverage_ratio', 0.0)),
      minimum_exhaustive_coverage_ratio: Number(getCoverage('minimum_exhaustive_coverage_ratio', 1.0)),
      allow_directory_citations: Boolean(getCoverage('allow_directory_citations', false)),
      require_verification_for_understood: Boolean(getCoverage('require_verification_for_understood', true)),
    },
    novice: {
      enforce: String(getNovice('enforce', 'block')),
      max_reading_grade_onramp: Number(getNovice('max_reading_grade_onramp', 8)),
      max_reading_grade_other: Number(getNovice('max_reading_grade_other', 12)),
      max_new_terms_per_section: Number(getNovice('max_new_terms_per_section', 3)),
      extra_jargon: Array.isArray(getNovice('extra_jargon', null)) ? getNovice('extra_jargon', []) : [],
      known_terms: Array.isArray(getNovice('known_terms', null)) ? getNovice('known_terms', []) : [],
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
      staleness_mode: String(getReview('staleness_mode', 'region')),
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
  let hasFrontmatter = false;

  let idx = 0;
  if (lines.length > 0 && lines[0].trim() === '---') {
    inFrontmatter.add(1);
    idx = 1;
    while (idx < lines.length) {
      inFrontmatter.add(idx + 1);
      if (lines[idx].trim() === '---' || lines[idx].trim() === '...') {
        hasFrontmatter = true;
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

  const frontmatter = hasFrontmatter && frontmatterLines.length
    ? parseSimpleYaml(frontmatterLines.join('\n')).flat
    : {};

  return { inFrontmatter, inCodeFence, frontmatter, hasFrontmatter };
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

/* ------------------------------------------- template section comparison */

let cachedTemplateSectionBodies = null;

function normalizeProse(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function loadTemplateSectionBodies() {
  if (cachedTemplateSectionBodies) return cachedTemplateSectionBodies;
  const map = new Map();
  const templatePath = join(KIT_ROOT, 'templates', 'feature-guide-template.md');
  if (!existsSync(templatePath)) {
    cachedTemplateSectionBodies = map;
    return map;
  }
  try {
    const lines = readLines(templatePath);
    const { inFrontmatter, inCodeFence } = scanLineContexts(lines);
    const topHeadings = [];
    lines.forEach((line, idx) => {
      const ln = idx + 1;
      if (inFrontmatter.has(ln) || inCodeFence.has(ln)) return;
      const m = HEADING_PATTERN.exec(line);
      if (m && m[1].length <= 2) {
        topHeadings.push({ line: ln, level: m[1].length, title: m[2] });
      }
    });
    for (const required of REQUIRED_SECTIONS) {
      const idx = topHeadings.findIndex((h) => h.title.toLowerCase().includes(required));
      if (idx === -1) continue;
      const startLine = topHeadings[idx].line + 1;
      const endLine = idx + 1 < topHeadings.length ? topHeadings[idx + 1].line - 1 : lines.length;
      const rawBody = lines.slice(startLine - 1, endLine).join('\n');
      const norm = normalizeProse(rawBody);
      if (norm) map.set(required, norm);
    }
  } catch {
    /* ignore */
  }
  cachedTemplateSectionBodies = map;
  return map;
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

export function resolveTarget(target, guideDir, repoRoot, syntax = 'inline-path') {
  if (!target) return null;
  const cleaned = target.replace(/\/+$/, '');
  const candidates = [];

  // Root-leading slash (/path/to/file.ts) means relative to repoRoot in Markdown preview and GitHub
  const isRootSlash =
    cleaned.startsWith('/') &&
    !cleaned.startsWith('//') &&
    (!isAbsolute(cleaned) || !existsSync(cleaned));

  if (isRootSlash) {
    candidates.push(join(repoRoot, cleaned.replace(/^\/+/, '')));
  } else if (isAbsolute(cleaned)) {
    candidates.push(cleaned);
  } else if (syntax === 'markdown-link') {
    // Clickable [label](target) links in Markdown preview resolve strictly relative to guideDir
    candidates.push(join(guideDir, cleaned));
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
 * Strip comments and string-literal contents from source lines so symbol verification
 * only matches actual code tokens rather than comments or string literals.
 */
export function stripCommentsAndStrings(lines, filePath = '') {
  const ext = extname(filePath).replace(/^\./, '').toLowerCase();
  const base = basename(filePath);
  const hashCommentExts = new Set([
    'py', 'rb', 'sh', 'bash', 'ps1', 'yaml', 'yml', 'toml', 'conf', 'ini', 'cfg', 'ex', 'exs',
  ]);
  const usesHashComments = hashCommentExts.has(ext) || EXTENSIONLESS_FILES.has(base);
  const usesSqlComments = ext === 'sql';

  let inBlockComment = false;
  let inHtmlComment = false;

  return lines.map((line) => {
    let out = '';
    let i = 0;
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;

    while (i < line.length) {
      const ch = line[i];
      const next = line[i + 1] ?? '';

      if (inBlockComment) {
        if (ch === '*' && next === '/') {
          inBlockComment = false;
          i += 2;
        } else {
          i += 1;
        }
        continue;
      }

      if (inHtmlComment) {
        if (ch === '-' && next === '-' && line[i + 2] === '>') {
          inHtmlComment = false;
          i += 3;
        } else {
          i += 1;
        }
        continue;
      }

      if (inSingle) {
        if (ch === '\\') i += 2;
        else if (ch === "'") {
          inSingle = false;
          out += "''";
          i += 1;
        } else i += 1;
        continue;
      }

      if (inDouble) {
        if (ch === '\\') i += 2;
        else if (ch === '"') {
          inDouble = false;
          out += '""';
          i += 1;
        } else i += 1;
        continue;
      }

      if (inBacktick) {
        if (ch === '\\') i += 2;
        else if (ch === '`') {
          inBacktick = false;
          out += '``';
          i += 1;
        } else i += 1;
        continue;
      }

      // Check comment starts outside strings
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') {
        inBlockComment = true;
        i += 2;
        continue;
      }
      if (ch === '<' && line.slice(i, i + 4) === '<!--') {
        inHtmlComment = true;
        i += 4;
        continue;
      }
      if (usesSqlComments && ch === '-' && next === '-') break;
      if (usesHashComments && ch === '#') break;

      if (ch === "'") {
        inSingle = true;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inDouble = true;
        i += 1;
        continue;
      }
      if (ch === '`') {
        inBacktick = true;
        i += 1;
        continue;
      }

      out += ch;
      i += 1;
    }

    return out;
  });
}

/**
 * Verify that a symbol exists as code (not merely in a comment or string literal)
 * in a source file and return its 1-based line number if found.
 */
export function findSymbolInFile(filePath, rawSymbol) {
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

  const rawLines = readLines(filePath);
  const codeLines = stripCommentsAndStrings(rawLines, filePath);
  const tokenRe = new RegExp(`\\b${escapeRe(primary)}\\b`);

  // Prefer declaration lines first (function, class, def, fn, func, const/let/var, type, interface, struct, method)
  const declRe = new RegExp(
    `(?:\\b(?:function|class|def|fn|func|const|let|var|type|interface|struct|enum|pub|export|async|static|get|set)\\b[^;]*\\b${escapeRe(primary)}\\b|\\b${escapeRe(primary)}\\s*(?:\\(|=|:))`,
  );

  const allPartsInCode = () =>
    parts.every((part) => {
      const re = new RegExp(`\\b${escapeRe(part)}\\b`);
      return codeLines.some((l) => re.test(l));
    });

  if (!allPartsInCode()) {
    return { found: false, line: null, identifier: primary };
  }

  for (let i = 0; i < codeLines.length; i += 1) {
    if (declRe.test(codeLines[i])) {
      return { found: true, line: i + 1, identifier: primary };
    }
  }

  for (let i = 0; i < codeLines.length; i += 1) {
    if (tokenRe.test(codeLines[i])) {
      return { found: true, line: i + 1, identifier: primary };
    }
  }

  return { found: false, line: null, identifier: primary };
}

/**
 * Compute the 1-based [startLine, endLine] excerpt window for a resolved reference.
 */
function computeExcerptWindow(item, fileLines) {
  let startLine = 1;
  let endLine = Math.min(fileLines.length, 35);
  let isScoped = false;

  if (item.line_start) {
    isScoped = true;
    startLine = Math.max(1, item.line_start - 3);
    endLine = Math.min(fileLines.length, (item.line_end ?? item.line_start) + 15);
  } else if (item.symbol_line) {
    isScoped = true;
    startLine = Math.max(1, item.symbol_line - 2);
    endLine = Math.min(fileLines.length, item.symbol_line + 25);
  } else if (item.anchor && item.path.endsWith('.md')) {
    isScoped = true;
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
  return {
    startLine,
    endLine,
    isScoped,
    excerpt,
    regionSha256: sha256Normalized(excerpt),
  };
}

/* ------------------------------------------------------------- gate parser */

/**
 * Parse `### [F-xx]` finding blocks from a review report to mechanically derive
 * open blocking count and severity weight instead of trusting self-reported table cells.
 */
export function parseFindingBlocks(lines) {
  const { inFrontmatter, inCodeFence } = scanLineContexts(lines);
  const findings = [];
  let current = null;
  let inBlockingSection = false;

  for (let i = 0; i < lines.length; i += 1) {
    const ln = i + 1;
    if (inFrontmatter.has(ln) || inCodeFence.has(ln)) continue;
    const line = lines[i];

    const hMatch = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (hMatch) {
      const level = hMatch[1].length;
      const title = hMatch[2].trim();
      if (level <= 2) {
        inBlockingSection = /blocking findings|findings/i.test(title);
        current = null;
        continue;
      }
      // Match ### [F-01] Title or ### F-01: Title
      const fMatch = /^\[?(F-\d+)\]?(?:\s*[:—-]\s*|\s+)(.*)$/i.exec(title);
      if (fMatch) {
        // Ignore the unedited template placeholder `### [F-01] [Short, specific finding]`
        if (/^\[short,\s*specific\s+finding\]$/i.test(fMatch[2].trim())) {
          current = null;
          continue;
        }
        current = {
          id: fMatch[1].toUpperCase(),
          title: fMatch[2].trim(),
          status: 'open',
          severity: inBlockingSection ? 'major' : 'minor',
          weight: inBlockingSection ? 2 : 1,
        };
        findings.push(current);
        continue;
      }
      current = null;
    }

    if (current) {
      const statusMatch = /^\s*-\s*\*\*Status:\*\*\s*(.+)$/i.exec(line);
      if (statusMatch) {
        const rawStatus = statusMatch[1].trim();
        // If unedited template like `open` | `closed`, default to open
        if (!rawStatus.includes('|')) {
          if (/\b(?:closed|resolved|fixed)\b/i.test(rawStatus)) current.status = 'closed';
          else if (/\bopen\b/i.test(rawStatus)) current.status = 'open';
        }
      }
      const sevMatch = /^\s*-\s*\*\*Severity:\*\*\s*(.+)$/i.exec(line);
      if (sevMatch) {
        const rawSev = sevMatch[1].trim();
        if (!rawSev.includes('|')) {
          if (/\bcritical\b/i.test(rawSev)) {
            current.severity = 'critical';
            current.weight = 3;
          } else if (/\b(?:major|blocking)\b/i.test(rawSev)) {
            current.severity = 'major';
            current.weight = 2;
          } else if (/\b(?:minor|non-blocking)\b/i.test(rawSev)) {
            current.severity = 'minor';
            current.weight = 1;
          }
        }
      }
    }
  }

  const openFindings = findings.filter((f) => f.status === 'open');
  const openBlocking = openFindings.filter((f) => f.weight >= 2).length;
  const severityWeight = openFindings.reduce((sum, f) => sum + f.weight, 0);

  return {
    findings,
    open_blocking: openBlocking,
    severity_weight: severityWeight,
  };
}

export function parseGate(reportPath, options = {}) {
  const {
    config = loadMasteryConfig(null),
    currentGuideHash = null,
    currentEvidenceHashes = null,
    currentEvidenceRegionHashes = null,
  } = options;
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

  // Check Guide sha256 binding and Evidence hashes (whole-file and scoped region) for staleness
  let reportGuideHash = null;
  let reportStatus = null;
  const reportEvidenceHashes = {};
  const reportRegionHashes = {};
  let stale = false;
  let softStale = false;
  const staleEvidence = [];
  const softStaleEvidence = [];

  for (const line of lines) {
    const stMatch = /^\s*-\s*\*\*Review\s+status:\*\*\s*(.+)$/i.exec(line);
    if (stMatch && !stMatch[1].includes('|')) {
      reportStatus = stMatch[1].replace(/`/g, '').trim().toUpperCase();
    }

    const gh = /^\s*-\s*\*\*Guide\s+(?:sha256|hash):\*\*\s*`?([a-f0-9]{64})`?/i.exec(line);
    if (gh) reportGuideHash = gh[1].toLowerCase();

    // Match `- path/to/file.ts: <64hex> (region: <64hex>)` or `- path/to/file.ts#sym: <64hex>`
    const eh =
      /^\s*(?:-\s*|\|\s*)`?([^\s|`]+?(?:\.[\w]+|(?:Makefile|Dockerfile|Containerfile|Justfile|Procfile|Gemfile|Rakefile))(?:#[^\s|`]+|:\d+(?:-\d+)?)?)`?\s*(?:\||:|->|→)\s*`?([a-f0-9]{64})`?(?:.*?\b(?:region|scoped)\s*[:=]?\s*`?([a-f0-9]{64})`?)?/i.exec(
        line,
      );
    if (eh) {
      const key = toPosix(eh[1].trim());
      const primaryHash = eh[2].toLowerCase();
      const explicitRegionHash = eh[3] ? eh[3].toLowerCase() : null;
      if (key.includes('#') || /:\d+/.test(key)) {
        reportRegionHashes[key] = primaryHash;
      } else {
        reportEvidenceHashes[key] = primaryHash;
        if (explicitRegionHash) {
          reportRegionHashes[key] = explicitRegionHash;
        }
      }
    }
  }

  if (thresholds.bind_approval_to_guide_and_evidence_hashes) {
    if (currentGuideHash && !reportGuideHash) {
      reasons.push('review report is missing Guide sha256 binding');
    }
    if (currentEvidenceHashes && Object.keys(currentEvidenceHashes).length > 0) {
      for (const relPath of Object.keys(currentEvidenceHashes)) {
        const hasFileHash = Boolean(reportEvidenceHashes[relPath]);
        const hasRegionHash = Object.keys(reportRegionHashes).some(
          (k) => k === relPath || k.startsWith(`${relPath}#`) || k.startsWith(`${relPath}:`),
        );
        if (!hasFileHash && !hasRegionHash) {
          reasons.push(`review report is missing evidence hash binding for ${relPath}`);
        }
      }
    }
  }

  if (reportGuideHash && currentGuideHash && reportGuideHash !== currentGuideHash.toLowerCase()) {
    stale = true;
    reasons.push('guide content changed since review report (sha256 mismatch)');
  }

  if (currentEvidenceHashes && Object.keys(reportEvidenceHashes).length > 0) {
    for (const [relPath, recordedHash] of Object.entries(reportEvidenceHashes)) {
      const currentHash = currentEvidenceHashes[relPath];
      if (!currentHash) {
        stale = true;
        staleEvidence.push(relPath);
        reasons.push(`evidence file missing or no longer cited: ${relPath}`);
      } else if (currentHash.toLowerCase() !== recordedHash) {
        // Check if region mode allows soft-stale when the cited region hash itself is unchanged
        const currentScoped = currentEvidenceRegionHashes?.[relPath];
        const recordedScoped = reportRegionHashes[relPath];
        if (
          thresholds.staleness_mode === 'region' &&
          currentScoped &&
          ((recordedScoped && recordedScoped === currentScoped.toLowerCase()) ||
            recordedHash === currentScoped.toLowerCase())
        ) {
          softStale = true;
          softStaleEvidence.push(relPath);
        } else {
          stale = true;
          staleEvidence.push(relPath);
          reasons.push(`evidence file changed since review: ${relPath}`);
        }
      }
    }
  }

  if (currentEvidenceRegionHashes && Object.keys(reportRegionHashes).length > 0) {
    for (const [regionKey, recordedRegionHash] of Object.entries(reportRegionHashes)) {
      if (reportEvidenceHashes[regionKey]) continue; // handled above
      const currentRegionHash = currentEvidenceRegionHashes[regionKey];
      if (!currentRegionHash || currentRegionHash.toLowerCase() !== recordedRegionHash) {
        stale = true;
        staleEvidence.push(regionKey);
        reasons.push(`cited evidence region changed since review: ${regionKey}`);
      }
    }
  }

  // Mechanically derive open findings and severity weight from ### [F-xx] blocks
  const parsedFindings = parseFindingBlocks(lines);

  let inGuess = false;
  const openGuesses = [];
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      inGuess = /^#{1,6}\s+guess log/i.test(line);
      continue;
    }
    if (inGuess && /^\s*-\s+\[on-ramp\]/i.test(line)) {
      if (/\(section,\s*line\)\s+the word or step,\s+and what you guessed it meant/i.test(line)) {
        continue;
      }
      openGuesses.push(line.trim());
    }
  }
  if (openGuesses.length) {
    reasons.push(
      `guess log has ${openGuesses.length} unresolved [on-ramp] entr${openGuesses.length === 1 ? 'y' : 'ies'}`,
    );
  }

  if (parsedFindings.open_blocking > 0) {
    const openIds = parsedFindings.findings
      .filter((f) => f.status === 'open' && f.weight >= 2)
      .map((f) => f.id)
      .join(', ');
    reasons.push(
      `review report has ${parsedFindings.open_blocking} open blocking finding(s): ${openIds}`,
    );
  }

  // Parse revision history to check convergence on the latest transition
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
      const modeCell = cells[1] ?? '';
      const changesCell = cells[2] ?? '';
      const openBlocking = /^\d+$/.test(cells[5]) ? Number(cells[5]) : null;
      const severityWeight = cells.length >= 8 && /^\d+$/.test(cells[6]) ? Number(cells[6]) : null;
      const resultCell = cells[7] ?? cells[6] ?? '';
      const strategyChanged = /strategy[_\s-]change|approach[_\s-]change|escalat|substantial_rewrite/i.test(
        `${modeCell} ${changesCell} ${resultCell}`,
      );
      if (openBlocking !== null) {
        historyRows.push({
          iteration: iter,
          open_blocking: openBlocking,
          severity_weight: severityWeight,
          strategy_changed: strategyChanged,
        });
      }
    }
  }

  // Cross-check self-reported latest history row against ### [F-xx] blocks when blocks are present
  if (parsedFindings.findings.length > 0 && historyRows.length > 0) {
    const latest = historyRows[historyRows.length - 1];
    if (latest.open_blocking !== parsedFindings.open_blocking) {
      reasons.push(
        `revision history self-reported open_blocking (${latest.open_blocking}) does not match ### [F-xx] blocks (${parsedFindings.open_blocking})`,
      );
    }
    if (
      latest.severity_weight !== null &&
      latest.severity_weight !== parsedFindings.severity_weight
    ) {
      reasons.push(
        `revision history self-reported severity_weight (${latest.severity_weight}) does not match ### [F-xx] blocks (${parsedFindings.severity_weight})`,
      );
    }
  } else if (parsedFindings.findings.length === 0 && historyRows.length > 0) {
    const latest = historyRows[historyRows.length - 1];
    if (latest.open_blocking > 0) {
      reasons.push(
        `revision history reports ${latest.open_blocking} open blocking finding(s) remaining`,
      );
    }
  }

  let convergenceOk = true;
  const stalledTransitions = [];
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
      const bothZero = prev.open_blocking === 0 && curr.open_blocking === 0;
      const stepOk = countDecreased || weightDecreased || bothZero || curr.strategy_changed;
      if (!stepOk) {
        stalledTransitions.push({ from: prev.iteration, to: curr.iteration });
      }
      // Only the latest transition blocks convergence so an earlier stalled round does not block forever after recovery
      if (i === historyRows.length - 1 && !stepOk) {
        convergenceOk = false;
        reasons.push(
          `latest revision iteration ${curr.iteration} did not reduce open blocking findings (${prev.open_blocking} -> ${curr.open_blocking}) or severity-weighted total`,
        );
      }
    }
  }

  return {
    review_status: reportStatus,
    scores_complete: complete,
    scores: [...scores.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([criterion, score]) => ({ criterion, score })),
    carried_criteria: carriedCriteria,
    rescored_criteria: rescoredCriteria,
    average,
    findings: parsedFindings.findings,
    open_blocking_findings: parsedFindings.open_blocking,
    open_severity_weight: parsedFindings.severity_weight,
    open_guesses: openGuesses,
    stale,
    soft_stale: softStale,
    stale_evidence: staleEvidence,
    soft_stale_evidence: softStaleEvidence,
    guide_sha256_in_report: reportGuideHash,
    convergence_ok: convergenceOk,
    stalled_transitions: stalledTransitions,
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

function checkConceptsAndJargon({
  lines,
  headings,
  inFrontmatter,
  inCodeFence,
  frontmatter,
  hasFrontmatter,
  guideFull,
  repoRoot,
  config,
}) {
  const frontmatterErrors = [];
  if (!hasFrontmatter) {
    frontmatterErrors.push(
      'missing YAML frontmatter (requires unit_id, unit_order, introduces, assumes)',
    );
  } else {
    const rawUnitId = frontmatter.unit_id;
    if (
      typeof rawUnitId !== 'string' ||
      !rawUnitId.trim() ||
      rawUnitId.trim() === '000-template' ||
      /^\[.*\]$/.test(rawUnitId.trim())
    ) {
      frontmatterErrors.push('frontmatter unit_id must be a non-placeholder string');
    }
    if (
      typeof frontmatter.unit_order !== 'number' ||
      !Number.isFinite(frontmatter.unit_order) ||
      frontmatter.unit_order < 1
    ) {
      frontmatterErrors.push('frontmatter unit_order must be a positive number (>= 1)');
    }
    if (!Array.isArray(frontmatter.introduces)) {
      frontmatterErrors.push('frontmatter introduces must be a YAML list (use [] if none)');
    }
    if (!Array.isArray(frontmatter.assumes)) {
      frontmatterErrors.push('frontmatter assumes must be a YAML list (use [] if none)');
    }
  }

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
  if (assumes.length > 0) {
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
    frontmatter_errors: frontmatterErrors,
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
    const { startLine, endLine, excerpt, regionSha256 } = computeExcerptWindow(item, fileLines);

    pack.push({
      path: item.path,
      layer: item.layer,
      raw: item.raw,
      symbol: item.symbol ?? null,
      anchor: item.anchor ?? null,
      start_line: startLine,
      end_line: endLine,
      sha256: sha256FileNormalized(absPath),
      region_sha256: regionSha256,
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
    out.push(`- **File sha256:** \`${item.sha256}\` (region: \`${item.region_sha256}\`)`);
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
  const guideSha256 = computeGuideFileSha256(guideFull);
  const { inFrontmatter, inCodeFence, frontmatter, hasFrontmatter } = scanLineContexts(lines);

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

  // Check required sections for empty, placeholder, or unedited template prose
  const templateBodies = loadTemplateSectionBodies();
  const emptyOrPlaceholderSections = [];
  const h1 = headings.find((h) => h.level === 1);
  if (h1 && /\[(?:feature|scope id|learner-facing title)/i.test(h1.title)) {
    emptyOrPlaceholderSections.push('title (unedited template placeholder)');
  }

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

    const normBody = normalizeProse(bodyText);
    const templateBody = templateBodies.get(required);

    if (
      !bodyText ||
      PLACEHOLDER_BODY_PATTERN.test(bodyText) ||
      (templateBody && normBody === templateBody)
    ) {
      emptyOrPlaceholderSections.push(required);
    }
  }

  const guideSlugs = headingSlugs(lines);
  const refs = extractReferences(lines, layerSplitLine);

  const resolved = [];
  const missing = [];
  const brokenAnchors = [];
  const missingSymbols = [];
  const vagueReferences = [];
  const evidenceHashes = {};
  const evidenceRegionHashes = {};
  const perFileScopedExcerpts = new Map();
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

    const resolvedTarget = resolveTarget(ref.target, guideDir, root, ref.syntax);
    if (!resolvedTarget) {
      let reason = 'path does not exist from guide directory or repository root';
      if (ref.syntax === 'markdown-link') {
        const repoFallback = resolveTarget(ref.target, root, root, 'inline-path');
        if (repoFallback) {
          const relFromGuide = toPosix(relative(guideDir, repoFallback.path));
          const suffix =
            ref.lineStart !== null
              ? `#L${ref.lineStart}${ref.lineEnd && ref.lineEnd !== ref.lineStart ? `-L${ref.lineEnd}` : ''}`
              : (ref.anchor ? `#${ref.anchor}` : '');
          reason = `clickable markdown link "${ref.raw}" resolves relative to the guide folder (${toPosix(relative(root, guideDir)) || '.'}) and will 404 in Markdown preview; use "${relFromGuide}${suffix}" (or "/${toPosix(relative(root, repoFallback.path))}${suffix}")`;
        } else {
          reason = 'clickable markdown link path does not exist relative to guide directory';
        }
      }
      missing.push({
        line: ref.line,
        layer: ref.layer,
        raw: ref.raw,
        target: ref.target,
        reason,
      });
      continue;
    }

    const targetPath = resolvedTarget.path;
    const relTargetPath = toPosix(relative(root, targetPath));

    if (resolvedTarget.isDirectory) {
      const dirDefect = {
        line: ref.line,
        layer: ref.layer,
        raw: ref.raw,
        target: relTargetPath,
        anchor: ref.raw,
        reason: `directory reference "${relTargetPath}/" is too vague; cite a specific file, symbol, or line range`,
      };
      brokenAnchors.push(dirDefect);
      vagueReferences.push(dirDefect);
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

    // Check symbol existence in target file (outside comments and strings)
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
          reason: `symbol "${symResult.identifier}" not found in code of ${relTargetPath}`,
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

    const resolvedItem = {
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
    };
    resolved.push(resolvedItem);

    // Compute region hash for region-aware staleness
    const targetLines = readLines(targetPath);
    const { isScoped, excerpt, regionSha256 } = computeExcerptWindow(resolvedItem, targetLines);
    if (ref.symbol) {
      const cleanSym = ref.symbol.replace(/\(\)$/, '');
      evidenceRegionHashes[`${relTargetPath}#${cleanSym}`] = regionSha256;
    } else if (ref.lineStart !== null) {
      const rangeLabel =
        ref.lineEnd && ref.lineEnd !== ref.lineStart
          ? `${ref.lineStart}-${ref.lineEnd}`
          : `${ref.lineStart}`;
      evidenceRegionHashes[`${relTargetPath}:${rangeLabel}`] = regionSha256;
    } else if (ref.anchor) {
      evidenceRegionHashes[`${relTargetPath}#${ref.anchor}`] = regionSha256;
    }

    if (!perFileScopedExcerpts.has(relTargetPath)) {
      perFileScopedExcerpts.set(relTargetPath, { allScoped: true, excerpts: [] });
    }
    const entry = perFileScopedExcerpts.get(relTargetPath);
    if (!isScoped) entry.allScoped = false;
    else entry.excerpts.push(excerpt);
  }

  for (const [relPath, info] of perFileScopedExcerpts.entries()) {
    if (info.allScoped && info.excerpts.length > 0) {
      evidenceRegionHashes[relPath] = sha256Normalized(info.excerpts.join('\n---\n'));
    }
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
    // Ignore unedited template placeholder rows like `| [Source-backed claim] | [path + symbol + lines] |`
    if (/^\s*\|\s*\[[^\]]+\]\s*\|/.test(line)) return;
    if (line.trim().length > 3) evidenceRows += 1;
  });

  if (
    evidenceRows === 0 &&
    !missingSections.includes('evidence and confidence') &&
    !emptyOrPlaceholderSections.includes('evidence and confidence')
  ) {
    emptyOrPlaceholderSections.push('evidence and confidence (no populated claim rows)');
  }

  const concepts = checkConceptsAndJargon({
    lines,
    headings,
    inFrontmatter,
    inCodeFence,
    frontmatter,
    hasFrontmatter,
    guideFull,
    repoRoot: root,
    config,
  });
  const novice = checkNovicePlainness({ lines, config: config.novice });

  const gate = reviewReport
    ? parseGate(resolve(reviewReport), {
        config,
        currentGuideHash: guideSha256,
        currentEvidenceHashes: evidenceHashes,
        currentEvidenceRegionHashes: evidenceRegionHashes,
      })
    : null;

  const blocking =
    missingSections.length +
      emptyOrPlaceholderSections.length +
      missing.length +
      brokenAnchors.length +
      missingSymbols.length +
      vagueReferences.length +
      concepts.frontmatter_errors.length +
      concepts.missing_prerequisites.length +
      concepts.premature_jargon.length +
      novice.frontmatter_errors.length +
      novice.blocking.length >
      0 ||
    evidenceRows === 0 ||
    Boolean(gate && (!gate.passes || gate.stale));

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
      vague_references: vagueReferences,
    },
    concepts,
    novice,
    evidence_rows: evidenceRows,
    evidence_hashes: evidenceHashes,
    evidence_region_hashes: evidenceRegionHashes,
    gate,
    stale: gate ? gate.stale : false,
    soft_stale: gate ? gate.soft_stale : false,
    ...(evidencePack ? { evidence_pack: evidencePack } : {}),
    blocking_problems: blocking,
    checked_at: new Date().toISOString(),
  };

  return { summary, blocking, evidencePack };
}

/* ------------------------------------------- calibration check */

/**
 * Verify that Stage-0 preflight and (optionally) a reviewer report properly reject
 * `references/calibration-bad-guide.md`. Optionally persists the calibration status in progress.json.
 */
export function calibrateReviewer({
  repoRoot = process.cwd(),
  reviewReport = null,
  model = null,
  record = false,
} = {}) {
  const root = resolve(repoRoot);
  const config = loadMasteryConfig(root);
  const fixtureCandidates = [
    join(root, '.adaptive-mastery', 'references', 'calibration-bad-guide.md'),
    join(KIT_ROOT, 'references', 'calibration-bad-guide.md'),
  ];
  const fixturePath = fixtureCandidates.find((c) => existsSync(c)) ?? fixtureCandidates[1];
  const reasons = [];

  const preflight = analyzeGuide({ guidePath: fixturePath, repoRoot: dirname(dirname(fixturePath)) });
  const backendFixtureOk =
    preflight.blocking === true &&
    preflight.summary.concepts.premature_jargon.length > 0 &&
    preflight.summary.concepts.missing_prerequisites.length > 0;

  if (!backendFixtureOk) {
    reasons.push('mechanical preflight failed to reject references/calibration-bad-guide.md');
  }

  const noviceFixtureCandidates = [
    join(root, '.adaptive-mastery', 'references', 'novice-bad-virtual-scroll.md'),
    join(KIT_ROOT, 'references', 'novice-bad-virtual-scroll.md'),
  ];
  const noviceFixturePath =
    noviceFixtureCandidates.find((c) => existsSync(c)) ?? noviceFixtureCandidates[1];
  let noviceFixtureOk = true;
  if (existsSync(noviceFixturePath)) {
    const noviceRes = checkNovicePlainness({
      lines: readLines(noviceFixturePath),
      config: config.novice,
    });
    const noviceCodes = new Set(noviceRes.blocking.map((b) => b.code));
    noviceFixtureOk =
      noviceRes.ok === false &&
      noviceRes.frontmatter_errors.length > 0 &&
      noviceCodes.has('code_in_onramp') &&
      noviceCodes.has('undeclared_jargon') &&
      noviceCodes.has('reading_grade');
    if (!noviceFixtureOk) {
      reasons.push('novice lint failed to reject references/novice-bad-virtual-scroll.md');
    }
  }

  const mechanicalOk = backendFixtureOk && noviceFixtureOk;

  let reviewerOk = null;
  let criteriaScores = null;
  if (reviewReport) {
    const gate = parseGate(resolve(reviewReport), {
      config: {
        ...config,
        review: {
          ...config.review,
          bind_approval_to_guide_and_evidence_hashes: false,
        },
      },
    });
    const scoreMap = new Map(gate.scores.map((s) => [s.criterion, s.score]));
    const c2 = scoreMap.get(2) ?? null;
    const c3 = scoreMap.get(3) ?? null;
    const c4 = scoreMap.get(4) ?? null;
    criteriaScores = { criterion_2: c2, criterion_3: c3, criterion_4: c4 };

    reviewerOk = true;
    if (gate.passes) {
      reviewerOk = false;
      reasons.push('reviewer passed the known-bad calibration fixture (gate.passes must be false)');
    }
    for (const [crit, val] of [
      [2, c2],
      [3, c3],
      [4, c4],
    ]) {
      if (val === null || val > 1) {
        reviewerOk = false;
        reasons.push(
          `calibration requires Criterion ${crit} to score <= 1 on references/calibration-bad-guide.md (got ${val ?? 'missing'})`,
        );
      }
    }
    if (gate.review_status && gate.review_status !== 'NEEDS_REVISION') {
      reviewerOk = false;
      reasons.push(
        `calibration requires Review status NEEDS_REVISION (got ${gate.review_status})`,
      );
    }
  }

  const ok = mechanicalOk && (reviewerOk === null || reviewerOk === true);
  const calibrationRecord = {
    passed: ok,
    mechanical_ok: mechanicalOk,
    reviewer_ok: reviewerOk,
    model: model ?? null,
    fixture_sha256: preflight.summary.guide_sha256,
    criteria_scores: criteriaScores,
    calibrated_at: new Date().toISOString(),
    reasons,
  };

  if (record) {
    const progressPath = join(root, config.paths.progress);
    if (existsSync(progressPath)) {
      try {
        const data = JSON.parse(readFileSync(progressPath, 'utf8'));
        if (!data.review_loop || typeof data.review_loop !== 'object') data.review_loop = {};
        if (model) data.review_loop.current_model = model;
        data.review_loop.calibration = calibrationRecord;
        writeFileSync(progressPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      } catch {
        /* ignore write failure */
      }
    }
  }

  return {
    ok,
    ...calibrationRecord,
  };
}

/* ------------------------------------------- state & coverage validation */

function globToRegExp(glob) {
  const normalized = toPosix(glob).replace(/^\/+/, '');
  let reStr = '^';
  let i = 0;
  while (i < normalized.length) {
    const ch = normalized[i];
    if (ch === '*' && normalized[i + 1] === '*') {
      if (normalized[i + 2] === '/') {
        reStr += '(?:.+/)?';
        i += 3;
      } else {
        reStr += '.*';
        i += 2;
      }
    } else if (ch === '*') {
      reStr += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      reStr += '[^/]';
      i += 1;
    } else {
      reStr += escapeRe(ch);
      i += 1;
    }
  }
  reStr += '$';
  return new RegExp(reStr, 'i');
}

function matchesAnyGlob(filePath, globs) {
  const posix = toPosix(filePath);
  return globs.some((g) => globToRegExp(g).test(posix));
}

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

function hasVerificationForTarget(completedTasks, candidates) {
  if (!Array.isArray(completedTasks) || completedTasks.length === 0) return false;
  const lowerCandidates = candidates.filter(Boolean).map((c) => String(c).toLowerCase());
  for (const entry of completedTasks) {
    if (typeof entry === 'string') {
      const lower = entry.toLowerCase();
      if (lowerCandidates.some((c) => lower.includes(c))) return true;
    } else if (entry && typeof entry === 'object') {
      const fields = [entry.unit_id, entry.feature_id, entry.concept, entry.id, entry.target]
        .filter(Boolean)
        .map((v) => String(v).toLowerCase());
      if (lowerCandidates.some((c) => fields.includes(c))) return true;
    }
  }
  return false;
}

/**
 * Validate `progress.json`, `feature-register.yaml`, guide approval gates & staleness,
 * active verification for `understood` items, reviewer calibration, and mechanical file coverage.
 */
export function validateRepositoryState({ repoRoot }) {
  const root = resolve(repoRoot ?? process.cwd());
  const config = loadMasteryConfig(root);
  const problems = [];
  const warnings = [];

  const progressPath = join(root, config.paths.progress);
  const registerPath = join(root, config.paths.feature_register);

  let progressValid = null;
  let progressData = null;
  let registerValid = null;
  let coverageReport = null;
  const staleUnits = [];
  const softStaleUnits = [];

  if (existsSync(progressPath)) {
    try {
      const data = JSON.parse(readFileSync(progressPath, 'utf8'));
      progressData = data;
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

      // Enforce that every concept marked "understood" has a completed verification task
      if (
        config.coverage.require_verification_for_understood &&
        data.learner_model?.concepts &&
        typeof data.learner_model.concepts === 'object'
      ) {
        const completedTasks = data.learner_model.completed_verification_tasks ?? [];
        for (const [conceptName, stateVal] of Object.entries(data.learner_model.concepts)) {
          const status =
            typeof stateVal === 'string'
              ? stateVal
              : (stateVal && typeof stateVal === 'object' ? stateVal.status : null);
          const unitId =
            stateVal && typeof stateVal === 'object' ? stateVal.unit_id : null;
          if (status === 'understood') {
            if (!hasVerificationForTarget(completedTasks, [conceptName, unitId])) {
              problems.push(
                `progress.json: concept "${conceptName}" is marked "understood" without a matching entry in learner_model.completed_verification_tasks`,
              );
            }
          }
        }
      }

      // Check reviewer calibration record if present
      if (data.review_loop?.calibration && typeof data.review_loop.calibration === 'object') {
        const cal = data.review_loop.calibration;
        if (cal.passed === false) {
          problems.push(
            'progress.json: review_loop.calibration.passed is false; reviewer failed the known-bad calibration fixture',
          );
        }
        if (
          data.review_loop.current_model &&
          cal.model &&
          data.review_loop.current_model !== cal.model
        ) {
          problems.push(
            `progress.json: active model "${data.review_loop.current_model}" differs from calibrated model "${cal.model}"; re-run "adaptive-mastery calibrate"`,
          );
        }
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
          const absClean = join(root, cleanPath);
          if (!existsSync(absClean)) {
            problems.push(`feature-register.yaml: feature "${id}" cites missing path "${cleanPath}"`);
            continue;
          }
          const st = statSync(absClean);
          if (st.isDirectory()) {
            if (!config.coverage.allow_directory_citations) {
              problems.push(
                `feature-register.yaml: feature "${id}" cites directory "${cleanPath}" instead of specific files`,
              );
            } else {
              citedPaths.add(toPosix(cleanPath));
            }
          } else {
            citedPaths.add(toPosix(cleanPath));
          }
        }

        if (feat.guide_path && !existsSync(join(root, String(feat.guide_path)))) {
          problems.push(`feature-register.yaml: feature "${id}" cites missing guide_path "${feat.guide_path}"`);
        }
        if (feat.review_path && !existsSync(join(root, String(feat.review_path)))) {
          problems.push(`feature-register.yaml: feature "${id}" cites missing review_path "${feat.review_path}"`);
        }

        if (feat.review_status === 'approved') {
          if (!feat.guide_path || !feat.review_path) {
            problems.push(
              `feature-register.yaml: feature "${id}" is marked approved but is missing guide_path or review_path`,
            );
          } else if (
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
            if (analysis.summary.soft_stale) {
              softStaleUnits.push(id);
              warnings.push(
                `feature-register.yaml: feature "${id}" has soft-stale evidence (edits outside cited regions: ${analysis.summary.gate?.soft_stale_evidence?.join(', ')})`,
              );
            }
            if (!analysis.summary.gate?.passes) {
              problems.push(
                `feature-register.yaml: feature "${id}" is marked approved but its review gate does not pass (${analysis.summary.gate?.reasons?.join('; ') || 'gate failed'})`,
              );
            } else if (analysis.blocking) {
              problems.push(
                `feature-register.yaml: feature "${id}" is marked approved but fails mechanical preflight`,
              );
            }
          }
        }

        if (
          feat.learning_status === 'understood' &&
          config.coverage.require_verification_for_understood
        ) {
          const completedTasks = progressData?.learner_model?.completed_verification_tasks ?? [];
          const candidates = [
            feat.id,
            feat.guide_path,
            ...(Array.isArray(feat.introduces_concepts) ? feat.introduces_concepts : []),
          ];
          if (!hasVerificationForTarget(completedTasks, candidates)) {
            problems.push(
              `feature-register.yaml: feature "${id}" has learning_status "understood" without a completed verification task in progress.json`,
            );
          }
        }
      }

      // Compute mechanical coverage against repository source files
      const learningRootPrefix = `${toPosix(config.paths.learning_root)}/`;
      const ignoreGlobs = config.coverage.ignore_globs ?? DEFAULT_COVERAGE_IGNORE_GLOBS;
      const allFiles = listRepositorySourceFiles(root).filter((f) => {
        if (f.startsWith('.adaptive-mastery/') || f.startsWith(learningRootPrefix)) return false;
        if (f.startsWith('.git/') || f.startsWith('.github/')) return false;
        if (matchesAnyGlob(f, ignoreGlobs)) return false;
        const ext = f.includes('.') ? f.split('.').pop().toLowerCase() : '';
        if (['md', 'txt', 'json', 'lock', 'gitignore', 'gitattributes'].includes(ext)) return false;
        return SOURCE_EXTENSIONS.includes(ext) || EXTENSIONLESS_FILES.has(basename(f));
      });

      const uncited = allFiles.filter((file) => {
        if (citedPaths.has(file)) return false;
        if (config.coverage.allow_directory_citations) {
          for (const cited of citedPaths) {
            if (file.startsWith(`${cited.replace(/\/+$/, '')}/`)) return false;
          }
        }
        return true;
      });

      const citedCount = allFiles.length - uncited.length;
      const coverageRatio =
        allFiles.length === 0 ? 1 : Math.round((citedCount / allFiles.length) * 1000) / 1000;

      const isExhaustiveOrReconciled =
        repository.inventory_status === 'reconciled' ||
        repository.inventory_status === 'exhaustive' ||
        progressData?.coverage?.inventory_status === 'reconciled' ||
        progressData?.repository?.bootstrap_mode === 'exhaustive';

      const requiredRatio = isExhaustiveOrReconciled
        ? config.coverage.minimum_exhaustive_coverage_ratio
        : config.coverage.minimum_coverage_ratio;

      if (allFiles.length > 0 && coverageRatio < requiredRatio) {
        problems.push(
          `feature-register.yaml: mechanical source coverage ${coverageRatio} (${citedCount}/${allFiles.length}) is below required minimum ${requiredRatio}`,
        );
      }

      coverageReport = {
        total_source_files: allFiles.length,
        cited_source_files: citedCount,
        coverage_ratio: coverageRatio,
        required_ratio: requiredRatio,
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
    soft_stale_units: softStaleUnits,
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
