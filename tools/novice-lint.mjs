#!/usr/bin/env node
/**
 * novice-lint: mechanical "can a stranger follow this?" checks for a feature guide.
 *
 * Why this exists: the preflight proves a guide is *valid* (paths resolve, sections exist) and the
 * reviewer judges it as a *simulated* beginner. Neither reliably catches domain jargon (WebGL, lerp,
 * shader...) or code names leaking into the first sections. This module checks the things a script
 * can know for certain, so the reviewer pass is spent on judgment, not on counting backticks.
 *
 * It caps nothing about length. It enforces ORDER: explain before use.
 *
 * Checks (B = blocks approval, W = warning):
 *   B  terms frontmatter present; each entry is "term :: plain-language meaning (>= 4 words)"
 *   B  on-ramp sections (first four) contain no inline code, no code fences (except `diagram`),
 *      and no links to source files; code names belong from section 5 onward
 *   B  jargon from the watchlist is used without being declared in `terms` / `assumes`
 *   B  a declared term's FIRST mention (headings included) is not in bold, i.e. not the defining mention
 *   B  a declared term first appears in "What this helps the user do" (need not yet established)
 *   B  reading grade of an on-ramp section above the configured limit
 *   W  more than N new terms first appear in one section
 *   W  reading grade of a later section above the limit
 *   W  "first idea" section has no everyday picture (imagine / picture / think of / like a ...)
 *   W  declared term never used
 *
 * Usage as a library: checkNovicePlainness({ lines, config })
 * Usage as a CLI:     node tools/novice-lint.mjs <guide.md>      (exit 1 when blocking)
 */
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const ONRAMP_SECTIONS = [
  'what this helps the user do',
  'why the feature needs to exist',
  'the first idea to understand',
  'follow one real example',
];

// Sections that are lookup material, not teaching. Not linted.
const SKIP_SECTIONS = [
  'technical reference',
  'evidence and confidence',
  'open questions',
  'internal author',
];

const DIAGRAM_INFO = new Set(['diagram', 'ascii', 'text', 'mermaid']);

export const GENERAL_JARGON = [
  'webgl', 'shader', 'shaders', 'lerp', 'gsap', 'tween', 'modulo', 'render target', 'render targets',
  'framebuffer', 'event listener', 'preventdefault', 'gpu', 'dom', 'api', 'callback', 'async',
  'middleware', 'regex', 'payload', 'serialize', 'abstraction', 'compositor', 'refresh rate',
  'delta time', 'animation frame', 'requestanimationframe', 'easing', 'throttle', 'debounce',
  'latency', 'thread', 'runtime', 'boolean', 'enum', 'refactor', 'instantiate', 'hz', 'fps',
  'polling', 'queue', 'cache', 'redis', 'outbox', 'idempotency', 'idempotent', 'lease', 'kafka',
  'websocket', 'endpoint', 'schema', 'orm', 'webhook', 'mutex', 'race condition',
];

export const DEFAULT_NOVICE_CONFIG = {
  enforce: 'block', // 'warn' downgrades every blocking finding to a warning
  max_reading_grade_onramp: 8,
  max_reading_grade_other: 12,
  max_new_terms_per_section: 3,
  extra_jargon: [],
  known_terms: [],
};

const HEADING = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([\w-]*)/;
const SOURCE_LINK =
  /\]\(([^)\s#]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|cs|php|swift|c|h|cpp|sql|json|ya?ml|toml|sh|css|html|vue|svelte))(?:[#:)\s]|$)/i;
const EVERYDAY_PICTURE =
  /\b(imagine|picture|think of|think about|as if|suppose|say you|it'?s like|it is like|like a|like an)\b/i;

const norm = (s) => String(s).toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (term) =>
  new RegExp(`(?<![\\w])${escapeRe(term).replace(/\s+/g, '\\s+')}(?![\\w])`, 'i');

function unquote(v) {
  const t = v.trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))
    ? t.slice(1, -1)
    : t;
}

/** Tiny frontmatter reader: scalar keys and block / inline lists. Enough for terms/assumes. */
function parseFrontmatter(lines) {
  if (lines[0]?.trim() !== '---') return { has: false, data: {}, end: 0 };
  const data = {};
  let key = null;
  let end = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const raw = lines[i];
    if (raw.trim() === '---' || raw.trim() === '...') {
      end = i + 1;
      break;
    }
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(unquote(item[1]));
      continue;
    }
    const kv = /^([\w-]+)\s*:\s*(.*)$/.exec(raw);
    if (!kv) continue;
    key = kv[1];
    const v = kv[2].trim();
    if (v === '' || v === '[]') data[key] = [];
    else if (v.startsWith('[') && v.endsWith(']')) {
      data[key] = v.slice(1, -1).split(',').map((x) => unquote(x)).filter(Boolean);
    } else data[key] = unquote(v);
  }
  return { has: end > 0, data, end };
}

function scan(lines) {
  const fm = parseFrontmatter(lines);
  const inFence = new Set();
  const fenceOpen = new Map();
  let active = null;
  for (let i = fm.end; i < lines.length; i += 1) {
    const m = FENCE.exec(lines[i]);
    if (!active) {
      if (m) {
        active = { ch: m[1][0], len: m[1].length };
        inFence.add(i + 1);
        fenceOpen.set(i + 1, (m[2] || '').toLowerCase());
      }
    } else {
      inFence.add(i + 1);
      if (m && m[1][0] === active.ch && m[1].length >= active.len && /^\s*[`~]+\s*$/.test(lines[i])) {
        active = null;
      }
    }
  }

  const sections = [];
  let cur = null;
  for (let i = fm.end; i < lines.length; i += 1) {
    const n = i + 1;
    const h = !inFence.has(n) ? HEADING.exec(lines[i]) : null;
    if (h && h[1].length === 1) {
      cur = null;
      continue;
    }
    if (h && h[1].length === 2) {
      cur = { title: h[2], key: norm(h[2]), line: n, lines: [] };
      sections.push(cur);
      cur.lines.push({ n, text: lines[i] });
      continue;
    }
    if (cur) cur.lines.push({ n, text: lines[i] });
  }
  return { fm, inFence, fenceOpen, sections };
}

function syllables(word) {
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = w.match(/[aeiouy]{1,2}/g);
  return m ? m.length : 1;
}

/** Plain prose of a section: no code, links, tables, quotes or headings; one sentence per list item. */
function proseOf(sectionLines, inFence) {
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) {
      let t = para.join(' ').trim();
      if (t && !/[.!?:]$/.test(t)) t += '.';
      out.push(t);
      para = [];
    }
  };
  for (const { n, text } of sectionLines) {
    if (inFence.has(n) || HEADING.test(text) || /^\s*[|>]/.test(text)) {
      flush();
      continue;
    }
    let t = text
      .replace(/<!--.*?-->/g, '')
      .replace(/`[^`]*`/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*_~]/g, '')
      .trim();
    if (!t) {
      flush();
      continue;
    }
    const bullet = /^(?:[-+]|\d+\.)\s+(.*)$/.exec(t);
    if (bullet) {
      flush();
      t = bullet[1].trim();
      out.push(/[.!?:]$/.test(t) ? t : `${t}.`);
    } else para.push(t);
  }
  flush();
  return out.join(' ');
}

export function readingGrade(text) {
  const cleaned = text.replace(/(\d)\.(\d)/g, '$1$2');
  const sentences = cleaned.split(/[.!?]+(?:\s+|$)/).filter((s) => /[a-z]/i.test(s));
  const words = cleaned.match(/[A-Za-z']+/g) ?? [];
  if (!sentences.length || !words.length) return { grade: 0, words: words.length, sentences: 0 };
  const syl = words.reduce((sum, w) => sum + syllables(w), 0);
  const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
  return { grade: Math.round(grade * 10) / 10, words: words.length, sentences: sentences.length };
}

function parseTerms(list) {
  const terms = [];
  const errors = [];
  for (const raw of list) {
    const [t, ...rest] = String(raw).split('::');
    const term = t.trim();
    const plain = rest.join('::').trim();
    if (!term || !plain) {
      errors.push(`terms entry "${raw}" must look like "term :: plain-language meaning"`);
      continue;
    }
    if (plain.split(/\s+/).length < 4) {
      errors.push(`terms entry "${term}" needs a plain-language meaning of at least 4 words`);
    }
    terms.push({ term, plain, norm: norm(term) });
  }
  return { terms, errors };
}

export function checkNovicePlainness({ lines, config = {} }) {
  const cfg = { ...DEFAULT_NOVICE_CONFIG, ...config };
  const { fm, inFence, fenceOpen, sections } = scan(lines);
  const blocking = [];
  const warnings = [];
  const frontmatterErrors = [];
  const add = (severity, code, line, message, extra = {}) => {
    const target = severity === 'block' && cfg.enforce !== 'warn' ? blocking : warnings;
    target.push({ code, line, message, ...extra });
  };
  const fmError = (message) => {
    if (cfg.enforce === 'warn') warnings.push({ code: 'frontmatter', line: 1, message });
    else frontmatterErrors.push(message);
  };

  // ---- declared vocabulary
  let terms = [];
  if (!fm.has) fmError('missing YAML frontmatter (needs a terms list)');
  else if (!Array.isArray(fm.data.terms)) {
    fmError('frontmatter terms must be a YAML list of "term :: plain meaning" (use [] if none)');
  } else {
    const parsed = parseTerms(fm.data.terms);
    terms = parsed.terms;
    parsed.errors.forEach(fmError);
  }
  const assumes = (Array.isArray(fm.data.assumes) ? fm.data.assumes : []).map(norm);
  const declared = new Set([...terms.map((t) => t.norm), ...assumes, ...cfg.known_terms.map(norm)]);
  const covered = (word) => [...declared].some((d) => d === word || d.includes(word) || word.includes(d));

  const linted = sections.filter((s) => !SKIP_SECTIONS.some((k) => s.key.includes(k)));
  const isOnramp = (s) => ONRAMP_SECTIONS.some((k) => s.key.includes(k));

  // ---- pass 1: code and jargon in the on-ramp, jargon everywhere
  const jargon = [...GENERAL_JARGON, ...cfg.extra_jargon.map(norm)];
  const reported = new Set();
  for (const s of linted) {
    const onramp = isOnramp(s);
    for (const { n, text } of s.lines) {
      if (inFence.has(n)) {
        if (onramp && fenceOpen.has(n) && !DIAGRAM_INFO.has(fenceOpen.get(n))) {
          add('block', 'code_block_in_onramp', n,
            `code block in on-ramp section "${s.title}"; show it from section 5 on, or label a plain-words picture as \`diagram\``);
        }
        continue;
      }
      const line = text.replace(/<!--.*?-->/g, '');
      if (onramp) {
        for (const m of line.matchAll(/`([^`]+)`/g)) {
          if (!declared.has(norm(m[1]))) {
            add('block', 'code_in_onramp', n,
              `\`${m[1]}\` appears in on-ramp section "${s.title}"; use a plain-words name here and give the code name in section 5`,
              { token: m[1] });
          }
        }
        if (SOURCE_LINK.test(line)) {
          add('block', 'source_link_in_onramp', n,
            `link to a source file in on-ramp section "${s.title}"; point to code only from section 5 on`);
        }
      }
      const forJargon = line.replace(/\]\([^)]*\)/g, ']');
      for (const term of jargon) {
        if (reported.has(term) || covered(term)) continue;
        if (wordRe(term).test(forJargon)) {
          reported.add(term);
          add('block', 'undeclared_jargon', n,
            `"${term}" is jargon and is not declared in terms (or assumes); define it in plain words at first use`,
            { term });
        }
      }
    }
  }

  // ---- pass 2: first mention of each declared term must be the defining (bold) mention
  const perSection = new Map();
  const termReport = [];
  for (const t of terms) {
    const re = wordRe(t.term);
    const bold = new RegExp(`\\*\\*[^*\\n]*${escapeRe(t.term).replace(/\s+/g, '\\s+')}[^*\\n]*\\*\\*`, 'i');
    let first = null;
    outer: for (const s of linted) {
      for (const { n, text } of s.lines) {
        if (inFence.has(n)) continue;
        if (re.test(text)) {
          first = { n, text, s };
          break outer;
        }
      }
    }
    if (!first) {
      add('warn', 'declared_term_never_used', 1, `declared term "${t.term}" never appears in the lesson`, { term: t.term });
      continue;
    }
    const defined = bold.test(first.text);
    termReport.push({ term: t.term, line: first.n, section: first.s.title, defined });
    perSection.set(first.s.title, (perSection.get(first.s.title) ?? 0) + 1);
    if (!defined) {
      add('block', 'first_mention_not_defined', first.n,
        `first mention of "${t.term}" is not its defining mention; bold it and explain it in plain words right there`,
        { term: t.term });
    }
    if (first.s.key.includes('what this helps the user do') && !assumes.includes(t.norm)) {
      add('block', 'term_before_need', first.n,
        `"${t.term}" appears before the problem it solves has been explained`, { term: t.term });
    }
  }
  for (const [title, count] of perSection) {
    if (count > cfg.max_new_terms_per_section) {
      add('warn', 'too_many_new_terms', 1,
        `${count} new terms first appear in "${title}" (limit ${cfg.max_new_terms_per_section}); split the idea or move some later`);
    }
  }

  // ---- pass 3: reading grade per section
  const reading = [];
  for (const s of linted) {
    const r = readingGrade(proseOf(s.lines, inFence));
    if (r.words < 25) continue;
    const onramp = isOnramp(s);
    reading.push({ section: s.title, grade: r.grade, words: r.words, onramp });
    const limit = onramp ? cfg.max_reading_grade_onramp : cfg.max_reading_grade_other;
    if (r.grade > limit) {
      add(onramp ? 'block' : 'warn', 'reading_grade', s.line,
        `reading grade ${r.grade} in "${s.title}" is above ${limit}; use shorter sentences and everyday words`,
        { grade: r.grade, limit });
    }
  }

  // ---- everyday picture in the first-idea section
  const idea = sections.find((s) => s.key.includes('the first idea to understand'));
  if (idea) {
    const prose = proseOf(idea.lines, inFence);
    if (!EVERYDAY_PICTURE.test(prose)) {
      add('warn', 'no_everyday_picture', idea.line,
        'the first-idea section has no everyday picture (try "Imagine ..." with something from daily life)');
    }
  }

  return {
    enforce: cfg.enforce,
    frontmatter_errors: frontmatterErrors,
    blocking,
    warnings,
    reading,
    terms: termReport,
    ok: frontmatterErrors.length === 0 && blocking.length === 0,
  };
}

function isDirect() {
  if (!process.argv[1]) return false;
  try {
    const a = realpathSync(process.argv[1]);
    const b = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    const a = resolve(process.argv[1]);
    const b = resolve(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
}

if (isDirect()) {
  const file = process.argv[2];
  if (!file) {
    process.stderr.write('usage: node tools/novice-lint.mjs <guide.md>\n');
    process.exitCode = 2;
  } else {
    const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
    const res = checkNovicePlainness({ lines });
    process.stdout.write(`${JSON.stringify(res, null, 2)}\n`);
    process.exitCode = res.ok ? 0 : 1;
  }
}
