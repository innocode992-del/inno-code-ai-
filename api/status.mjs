/**
 * Inno Code - Vercel Node.js Function
 * GET /api/status
 */
export default function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'الطريقة دي مش مدعومة.' });
  }

  const apiKey = process.env.OPENAI_API_KEY || '';
  const configured = Boolean(
    apiKey &&
    !apiKey.includes('PASTE_') &&
    apiKey !== 'your_api_key_here'
  );

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    configured,
    model: process.env.OPENAI_MODEL || 'gpt-6.2-astra',
  });
}
