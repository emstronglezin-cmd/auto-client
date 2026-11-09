import test from 'node:test';
import assert from 'node:assert/strict';
process.env.UNSUBSCRIBE_SECRET = 'test-secret-for-unit-tests';
const { escapeHtml, demoHtml, makeUnsubscribeToken, verifyUnsubscribeToken, CATEGORIES } = await import('../src/services.js');
const { validateConfig } = await import('../src/config.js');

test('HTML escaping prevents tag injection', () => {
  assert.equal(escapeHtml(`<script a="b">'&`), '&lt;script a=&quot;b&quot;&gt;&#39;&amp;');
});

test('unsubscribe token verifies only its original lead id', () => {
  const token = makeUnsubscribeToken('lead-123');
  assert.equal(verifyUnsubscribeToken(token), 'lead-123');
  assert.equal(verifyUnsubscribeToken(`${token}x`), null);
  assert.equal(verifyUnsubscribeToken('not-a-token'), null);
});

test('category map and demo template are complete and escape business data', () => {
  assert.ok(Object.keys(CATEGORIES).length >= 25);
  assert.ok(['restaurant','dentiste','veterinaire','plombier','electricien','avocat'].every(key => Object.hasOwn(CATEGORIES,key)));
  const html = demoHtml({name:'<Test Shop>',category:'restaurant',city:'Austin',email:'x@example.com'}, {headline:'Hello', description:'Description', services:['A','B','C'],hours:[]});
  assert.match(html, /&lt;Test Shop&gt;/);
  assert.match(html, /Aperçu gratuit préparé pour/);
  assert.match(html, /Fictional suggested hours/);
  assert.match(html, /cdn\.tailwindcss\.com/);
});
