import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DRY_RUN = 'true';
for (const key of ['ADMIN_TOKEN','DATABASE_URL','PUBLIC_BASE_URL','UNSUBSCRIBE_SECRET']) delete process.env[key];
const { validateConfig } = await import('../src/config.js');

test('missing Render secrets are reported without preventing startup', () => {
  let missing;
  assert.doesNotThrow(() => { missing = validateConfig(); });
  assert.ok(missing.includes('ADMIN_TOKEN'));
  assert.ok(missing.includes('DATABASE_URL'));
});
