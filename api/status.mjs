/**
 * Inno Code - Vercel Node.js Function
 * GET /api/status
 * Reports whether Gemini credentials are configured (does not expose the key).
 */
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'الطريقة دي مش مدعومة.' });
  }

  const apiKey = process.env.GEMINI_API_KEY || '';
  const configured = Boolean(
    apiKey &&
    !apiKey.includes('PASTE_') &&
    apiKey !== 'your_api_key_here'
  );

  return res.status(200).json({
    configured,
    provider: 'Gemini',
    model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  });
}
