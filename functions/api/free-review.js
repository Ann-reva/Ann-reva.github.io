const reply = (message, status) => new Response(JSON.stringify({ message }), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

export async function onRequestPost({ request, env }) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return reply('Expected JSON', 415);
  }
  if (Number(request.headers.get('content-length') || 0) > 12000) {
    return reply('Request too large', 413);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > 12000) return reply('Request too large', 413);
    body = JSON.parse(raw);
  } catch {
    return reply('Invalid JSON', 400);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply('Invalid request', 400);
  if (body.companyWebsite) return reply('Request received', 200);

  const limits = {
    name: 120, email: 254, businessName: 150, businessDescription: 2000,
    automationRequest: 3000, website: 500, tools: 500, phone: 50,
  };
  const fields = {};
  for (const [key, limit] of Object.entries(limits)) {
    if (body[key] != null && typeof body[key] !== 'string') return reply('Invalid field', 400);
    fields[key] = (body[key] || '').trim();
    if (fields[key].length > limit) return reply('Field too long', 400);
  }
  if (!fields.name || !fields.businessName || !fields.businessDescription || !fields.automationRequest ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return reply('Please complete the required fields', 400);
  if (fields.website) {
    try {
      const url = new URL(fields.website);
      if (!['http:', 'https:'].includes(url.protocol)) return reply('Invalid website URL', 400);
    } catch { return reply('Invalid website URL', 400); }
  }
  if (!env.N8N_WEBHOOK_URL || !env.TURNSTILE_SECRET_KEY) return reply('Service unavailable', 503);

  const token = body['cf-turnstile-response'];
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return reply('Please complete the security check', 400);
  }

  try {
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!verification.ok) return reply('Security check unavailable', 503);
    const result = await verification.json();
    if (!result.success || !['anyalazarenko.com', 'www.anyalazarenko.com'].includes(result.hostname)) {
      return reply('Security check failed', 403);
    }
  } catch {
    return reply('Security check unavailable', 503);
  }

  try {
    const response = await fetch(env.N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return reply('Service unavailable', 502);
    return reply('Request received', 200);
  } catch {
    return reply('Service unavailable', 502);
  }
}

export function onRequestGet() {
  return reply('Method not allowed', 405);
}
