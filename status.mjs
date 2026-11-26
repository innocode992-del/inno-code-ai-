export default async function handler(request) {
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'الطريقة دي مش مدعومة.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  const key = process.env.OPENAI_API_KEY || '';
  const configured = Boolean(key && !key.includes('PASTE_') && key !== 'your_api_key_here');
  return new Response(JSON.stringify({ configured, model: process.env.OPENAI_MODEL || 'gpt-6.2-sol' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
