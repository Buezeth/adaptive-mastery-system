import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { checkNovicePlainness, readingGrade } from '../tools/novice-lint.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const load = (name) =>
  readFileSync(join(HERE, 'fixtures', name), 'utf8').replace(/\r\n/g, '\n').split('\n');
const codes = (res) => new Set(res.blocking.map((b) => b.code));

// Small guide builder so each test changes exactly one thing.
function guide({ terms = [], first = '', helps = 'You travel through places with your mouse wheel.', rest = '' } = {}) {
  return [
    '---',
    'unit_id: "t"',
    'unit_order: 1',
    'introduces: []',
    'assumes: []',
    terms.length ? 'terms:' : 'terms: []',
    ...terms.map((t) => `  - "${t}"`),
    '---',
    '',
    '# Title',
    '',
    '## What this helps the user do',
    helps,
    '',
    '## Why the feature needs to exist',
    'A normal page ends at the bottom, but this journey never ends, so the site needs its own way to move.',
    '',
    '## The first idea to understand',
    first || 'Imagine pulling a cart with a stretchy cord, so the cart follows your hand and glides to a stop.',
    '',
    '## Follow one real example through the system',
    'Say you flick the wheel once. The position moves a little, then a little less, until it stops.',
    '',
    rest,
  ].join('\n').split('\n');
}

describe('the guide the kit actually produced (known-bad)', () => {
  const res = checkNovicePlainness({ lines: load('novice-bad-virtual-scroll.md') });

  test('is blocked', () => assert.equal(res.ok, false));
  test('missing terms list is a frontmatter error', () => assert.equal(res.frontmatter_errors.length, 1));
  test('flags code names, a code block and source links in the on-ramp', () => {
    for (const c of ['code_in_onramp', 'code_block_in_onramp', 'source_link_in_onramp']) {
      assert.ok(codes(res).has(c), `expected ${c}`);
    }
  });
  test('flags the domain jargon the old watchlist could not see', () => {
    const terms = res.blocking.filter((b) => b.code === 'undeclared_jargon').map((b) => b.term);
    for (const t of ['webgl', 'lerp', 'gsap', 'modulo']) assert.ok(terms.includes(t), `expected ${t}`);
  });
  test('every on-ramp section reads above grade 8', () => {
    assert.ok(res.reading.filter((r) => r.onramp).every((r) => r.grade > 8));
  });
});

describe('the novice-first rewrite of the same guide', () => {
  const res = checkNovicePlainness({ lines: load('novice-good-virtual-scroll.md') });
  test('passes with no blocking findings and no warnings', () => {
    assert.deepEqual(res.blocking, []);
    assert.deepEqual(res.warnings, []);
    assert.equal(res.ok, true);
  });
  test('every declared term is defined at its first mention', () => {
    assert.equal(res.terms.length, 3);
    assert.ok(res.terms.every((t) => t.defined));
  });
});

describe('individual rules', () => {
  const T = 'damping :: smoothing that makes movement ease in and out gradually';

  test('first mention that is not bold is blocked', () => {
    const res = checkNovicePlainness({ lines: guide({ terms: [T], first: 'Imagine a cart. Damping makes it glide.' }) });
    assert.ok(codes(res).has('first_mention_not_defined'));
  });

  test('bold first mention is accepted', () => {
    const res = checkNovicePlainness({ lines: guide({ terms: [T], first: 'Imagine a cart. **Damping** makes it glide.' }) });
    assert.equal(res.ok, true);
  });

  test('a term used in the opening section is blocked as "before the need"', () => {
    const res = checkNovicePlainness({
      lines: guide({ terms: [T], helps: 'The site uses **damping** to move you.', first: 'Imagine a cart that glides.' }),
    });
    assert.ok(codes(res).has('term_before_need'));
  });

  test('a term in a heading counts as a mention', () => {
    const res = checkNovicePlainness({
      lines: guide({ terms: [T], first: 'Imagine a cart that glides.', rest: '### How damping works\nIt eases motion.' }),
    });
    assert.ok(codes(res).has('first_mention_not_defined'));
  });

  test('terms entries need a real plain-language meaning', () => {
    const res = checkNovicePlainness({ lines: guide({ terms: ['damping :: smoothing'] }) });
    assert.equal(res.frontmatter_errors.length, 1);
  });

  test('jargon declared in terms is allowed', () => {
    const res = checkNovicePlainness({
      lines: guide({ terms: ['shader :: a small program that decides the colour of every dot on screen'], first: 'Imagine a painter. A **shader** is like a painter for every dot.' }),
    });
    assert.ok(!codes(res).has('undeclared_jargon'));
  });

  test('code names are allowed after the on-ramp', () => {
    const res = checkNovicePlainness({
      lines: guide({ rest: '## How the implementation makes it happen\nThe wish position is stored in `targetY2`.' }),
    });
    assert.equal(res.ok, true);
  });

  test('a diagram fence is allowed in the on-ramp, a bare code fence is not', () => {
    const picture = ['', '```diagram', 'hand -> cart', '```'].join('\n');
    assert.equal(checkNovicePlainness({ lines: guide({ first: `Imagine a cart.${picture}` }) }).ok, true);
    const bare = ['', '```', 'hand -> cart', '```'].join('\n');
    assert.ok(codes(checkNovicePlainness({ lines: guide({ first: `Imagine a cart.${bare}` }) })).has('code_block_in_onramp'));
  });

  test('enforce: warn downgrades blocking findings', () => {
    const res = checkNovicePlainness({ lines: load('novice-bad-virtual-scroll.md'), config: { enforce: 'warn' } });
    assert.equal(res.ok, true);
    assert.ok(res.warnings.length > 20);
  });

  test('missing everyday picture is only a warning', () => {
    const res = checkNovicePlainness({ lines: guide({ first: 'The site keeps a number. Each key press changes it.' }) });
    assert.equal(res.ok, true);
    assert.ok(res.warnings.some((w) => w.code === 'no_everyday_picture'));
  });

  test('too many new terms in one section is a warning', () => {
    const t = ['alpha idea :: the first thing we need to know here', 'beta idea :: the second thing we need to know here', 'gamma idea :: the third thing we need to know here', 'delta idea :: the fourth thing we need to know here'];
    const res = checkNovicePlainness({
      lines: guide({ terms: t, first: 'Imagine a cart. **Alpha idea**, **beta idea**, **gamma idea** and **delta idea** all matter.' }),
    });
    assert.ok(res.warnings.some((w) => w.code === 'too_many_new_terms'));
  });
});

describe('readingGrade', () => {
  test('short plain sentences score low, dense ones high', () => {
    assert.ok(readingGrade('The cat sat on the mat. It was warm. The dog came in.').grade < 3);
    assert.ok(
      readingGrade('Asynchronous synchronization mechanisms necessitate comprehensive architectural considerations regarding infrastructure.').grade > 15,
    );
  });
});
