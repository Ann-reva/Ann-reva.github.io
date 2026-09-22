import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { onRequestPost } from '../functions/api/free-review.js';

const env = {
  N8N_WEBHOOK_URL: 'https://n8n.example.test/webhook/free-review',
  TURNSTILE_SECRET_KEY: 'test-secret',
};
const lead = {
  name: 'Test Client',
  email: 'client@example.com',
  businessName: 'Example Business',
  businessDescription: 'A small service business.',
  automationRequest: 'Automate follow-up emails.',
  'cf-turnstile-response': 'verified-token',
};
const post = (body, config = env) => onRequestPost({
  request: new Request('https://anyalazarenko.com/api/free-review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }),
  env: config,
});

afterEach(() => mock.restoreAll());

test('homepage uses the current portrait and Free Review page contains the verification widget', () => {
  const home = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const review = readFileSync(new URL('../automation.html', import.meta.url), 'utf8');
  assert.match(home, /<img src="Subject_2\.png" alt="Anya Lazarenko">/);
  assert.ok(existsSync(new URL('../Subject_2.png', import.meta.url)));
  assert.match(review, /data-sitekey="0x4AAAAAAE_iDpi6MqyoBjqm"/);
  assert.match(review, /name="email" type="email"/);
});

test('public pages do not expose a personal email address or phone number', () => {
  for (const page of ['index.html', 'automation.html', 'privacy.html']) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /mailto:[^"']+@gmail\.com/i, page);
    assert.doesNotMatch(html, /tel:[^"']+/i, page);
  }
});

test('rejects invalid submissions without calling external services', async () => {
  const calls = [];
  mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); throw new Error('unexpected fetch'); });
  assert.equal((await post({ ...lead, email: 'invalid' })).status, 400);
  assert.equal((await post({ ...lead, 'cf-turnstile-response': '' })).status, 400);
  assert.equal((await post({ ...lead, website: 'javascript:alert(1)' })).status, 400);
  assert.equal((await post({ ...lead, extra: 'x'.repeat(13000) })).status, 413);
  assert.equal(calls.length, 0);
});

test('discards honeypot submissions without saving a lead', async () => {
  const calls = [];
  mock.method(globalThis, 'fetch', async (...args) => { calls.push(args); throw new Error('unexpected fetch'); });
  const result = await post({ ...lead, companyWebsite: 'https://spam.example' });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 0);
});

test('valid Turnstile token forwards one sanitized lead to n8n', async () => {
  const calls = [];
  mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return Response.json({ success: true, hostname: 'anyalazarenko.com' });
    return Response.json({ ok: true });
  });
  const result = await post({ ...lead, tools: 'Gmail' });
  assert.equal(result.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(calls[1].url, env.N8N_WEBHOOK_URL);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    name: lead.name, email: lead.email, businessName: lead.businessName,
    businessDescription: lead.businessDescription, automationRequest: lead.automationRequest,
    website: '', tools: 'Gmail', phone: '',
  });
});

test('failed or wrong-domain verification never reaches n8n', async () => {
  const calls = [];
  mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    return Response.json({ success: true, hostname: 'attacker.example' });
  });
  assert.equal((await post(lead)).status, 403);
  assert.equal(calls.length, 1);
});

test('missing secret or unavailable lead service reports an error', async () => {
  assert.equal((await post(lead, { N8N_WEBHOOK_URL: env.N8N_WEBHOOK_URL })).status, 503);
  mock.method(globalThis, 'fetch', async (url) => url.includes('siteverify')
    ? Response.json({ success: true, hostname: 'anyalazarenko.com' })
    : new Response('unavailable', { status: 503 }));
  assert.equal((await post(lead)).status, 502);
});
