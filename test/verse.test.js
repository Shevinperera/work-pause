import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSES, verseForDate, colomboDateKey, dayNumber, verseSize } from '../verse.js';

test('verse list is well formed and has no duplicates', () => {
  assert.ok(VERSES.length >= 60, `only ${VERSES.length} verses`);
  const refs = new Set();
  for (const v of VERSES) {
    assert.match(v.ref, /^(\d )?[A-Z][a-z]+(?: [A-Z][a-z]+)? \d+:\d+(–\d+)?$/, `bad ref ${v.ref}`);
    assert.ok(v.text.length > 15, `short text for ${v.ref}`);
    assert.match(v.text, /[.?]$/, `text for ${v.ref} should end with . or ?`);
    assert.ok(!/\s{2,}/.test(v.text), `double space in ${v.ref}`);
    assert.ok(!refs.has(v.ref), `duplicate ${v.ref}`);
    refs.add(v.ref);
  }
});

test('same date always gives the same verse', () => {
  assert.deepEqual(verseForDate('2026-10-30'), verseForDate('2026-10-30'));
});

test('consecutive days give different verses, and every verse appears once per cycle', () => {
  const seen = new Set();
  let prev = null;
  let key = '2026-01-01';
  for (let i = 0; i < VERSES.length; i++) {
    const v = verseForDate(key);
    assert.notEqual(v.ref, prev, `repeat on ${key}`);
    seen.add(v.ref);
    prev = v.ref;
    key = new Date(Date.parse(`${key}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  assert.equal(seen.size, VERSES.length);
});

test('day rolls over at midnight Asia/Colombo, not UTC or the machine zone', () => {
  // 18:29 UTC = 23:59 Colombo (still the 30th); 18:30 UTC = 00:00 on the 31st
  assert.equal(colomboDateKey(Date.parse('2026-10-30T18:29:00Z')), '2026-10-30');
  assert.equal(colomboDateKey(Date.parse('2026-10-30T18:30:00Z')), '2026-10-31');
  assert.notEqual(
    verseForDate(colomboDateKey(Date.parse('2026-10-30T18:29:00Z'))).ref,
    verseForDate(colomboDateKey(Date.parse('2026-10-30T18:30:00Z'))).ref,
  );
});

test('dayNumber handles dates before 1970 without a negative index', () => {
  assert.equal(dayNumber('1970-01-01'), 0);
  assert.ok(verseForDate('1969-12-31'));
});

test('size buckets', () => {
  assert.equal(verseSize('Be still, and know that I am God.'), 'short');
  assert.equal(verseSize('x'.repeat(100)), 'medium');
  assert.equal(verseSize('x'.repeat(200)), 'long');
  const sizes = new Set(VERSES.map((v) => verseSize(v.text)));
  assert.deepEqual([...sizes].sort(), ['long', 'medium', 'short']);
});

