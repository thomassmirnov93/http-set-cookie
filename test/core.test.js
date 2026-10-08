import { test } from 'node:test';
import * as assert from 'node:assert/strict';

import { parseSetCookie, formatDate } from '../src/index.js';

test('happy path: name/value and attributes', () => {
  const c = parseSetCookie('id=abc; Domain=example.org; Path=/; Secure; HttpOnly');
  assert.equal(c.name, 'id');
  assert.equal(c.value, 'abc');
  assert.equal(c.domain, 'example.org');
  assert.equal(c.path, '/');
  assert.equal(c.secure, true);
  assert.equal(c.httpOnly, true);
  assert.equal(c.expires, null);
  assert.equal(c.maxAge, null);
  assert.equal(c.sameSite, null);
});

test('parses Max-Age as a number', () => {
  const c = parseSetCookie('tok=xyz; Max-Age=3600');
  assert.equal(c.maxAge, 3600);
});

test('Max-Age of zero is kept (immediate expiry)', () => {
  const c = parseSetCookie('tok=xyz; Max-Age=0');
  assert.equal(c.maxAge, 0);
});

test('Max-Age with leading plus is rejected', () => {
  const c = parseSetCookie('tok=xyz; Max-Age=+10');
  assert.equal(c.maxAge, null);
});

test('Max-Age with trailing garbage is rejected', () => {
  const c = parseSetCookie('tok=xyz; Max-Age=10s');
  assert.equal(c.maxAge, null);
});

test('Max-Age with negative value is rejected', () => {
  const c = parseSetCookie('tok=xyz; Max-Age=-1');
  assert.equal(c.maxAge, null);
});

test('SameSite values are normalised to canonical case', () => {
  assert.equal(parseSetCookie('x=1; SameSite=lax').sameSite, 'Lax');
  assert.equal(parseSetCookie('x=1; SameSite=STRICT').sameSite, 'Strict');
  assert.equal(parseSetCookie('x=1; SameSite=NoNe').sameSite, 'None');
});

test('unknown SameSite value is dropped (null), not guessed', () => {
  const c = parseSetCookie('x=1; SameSite=Banana');
  assert.equal(c.sameSite, null);
});

test('Expires is preserved verbatim, not parsed', () => {
  const raw = 'Wed, 09 Jun 2021 10:18:14 GMT';
  const c = parseSetCookie('id=abc; Expires=' + raw);
  assert.equal(c.expires, raw);
});

test('quoted value has outer quotes stripped', () => {
  const c = parseSetCookie('id="hello world"; Path=/');
  assert.equal(c.value, 'hello world');
});

test('quoted value with inner quotes keeps the inner quotes', () => {
  const c = parseSetCookie('id="a\"b"');
  assert.equal(c.value, 'a"b');
});

test('attribute names are case-insensitive', () => {
  const c = parseSetCookie('x=1; DOMAIN=ex.org; PATH=/p');
  assert.equal(c.domain, 'ex.org');
  assert.equal(c.path, '/p');
});

test('empty string returns null', () => {
  assert.equal(parseSetCookie(''), null);
});

test('non-string input returns null', () => {
  assert.equal(parseSetCookie(null), null);
  assert.equal(parseSetCookie(undefined), null);
  assert.equal(parseSetCookie(42), null);
});

test('name without equals becomes value-less cookie', () => {
  const c = parseSetCookie('flag; Secure');
  assert.equal(c.name, 'flag');
  assert.equal(c.value, '');
  assert.equal(c.secure, true);
});

test('leading equals with no name returns null', () => {
  assert.equal(parseSetCookie('=value'), null);
});

test('unknown attributes are captured in extras', () => {
  const c = parseSetCookie('x=1; Priority=High; SameParty');
  assert.equal(c.extras.get('priority'), 'High');
  assert.equal(c.extras.get('sameparty'), '');
});

test('extras holds first occurrence on duplicate unknown attributes', () => {
  const c = parseSetCookie('x=1; Foo=1; Foo=2');
  assert.equal(c.extras.get('foo'), '1');
});

test('duplicate known attributes: last-wins', () => {
  const c = parseSetCookie('x=1; Path=/a; Path=/b');
  assert.equal(c.path, '/b');
});

test('empty Domain attribute is preserved as empty string', () => {
  const c = parseSetCookie('x=1; Domain=');
  assert.equal(c.domain, '');
});

test('whitespace around attributes is trimmed', () => {
  const c = parseSetCookie('x=1;   Path=/posts  ;  Secure  ');
  assert.equal(c.path, '/posts');
  assert.equal(c.secure, true);
});

test('cookie with only a name and value', () => {
  const c = parseSetCookie('k=v');
  assert.equal(c.name, 'k');
  assert.equal(c.value, 'v');
  assert.equal(c.domain, null);
  assert.equal(c.path, null);
  assert.equal(c.secure, false);
  assert.equal(c.httpOnly, false);
});

test('formatDate produces a GMT string independent of host timezone', () => {
  // 2021-06-09T10:18:14.000Z — chosen because it is unambiguous.
  const d = new Date(Date.UTC(2021, 5, 9, 10, 18, 14));
  assert.equal(formatDate(d), 'Wed, 09 Jun 2021 10:18:14 GMT');
});

test('formatDate throws on invalid Date', () => {
  assert.throws(() => formatDate(new Date('not a date')), TypeError);
});

test('formatDate throws on non-Date', () => {
  assert.throws(() => formatDate('2021-06-09'), TypeError);
});

test('leading semicolons with no name/value return null', () => {
  assert.equal(parseSetCookie('; Secure'), null);
});
