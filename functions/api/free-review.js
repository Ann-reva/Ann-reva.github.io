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
    body = await request.json();
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
  if (!env.N8N_WEBHOOK_URL) return reply('Service unavailable', 503);

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
