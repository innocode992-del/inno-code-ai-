/**
 * Inno Code - Vercel Node.js Function
 * POST /api/chat
 * Uses the OpenAI Responses API. Keep OPENAI_API_KEY in Vercel Environment Variables.
 */

const DEFAULT_MODEL = 'gpt-6.2-astra';
const MAX_BODY_BYTES = 160_000;
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 10_000;
const OPENAI_TIMEOUT_MS = 45_000;

function sendJson(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(payload);
}

async function readRequestBody(req) {
  // Vercel's Node.js runtime normally parses application/json into req.body.
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}');
  }

  // Fallback for an unparsed request stream.
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error('BODY_TOO_LARGE');
      error.code = 'BODY_TOO_LARGE';
      throw error;
    }
    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  return JSON.parse(raw || '{}');
}

function extractOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const pieces = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        pieces.push(part.text);
      } else if (part?.type === 'refusal' && typeof part.refusal === 'string') {
        pieces.push(part.refusal);
      }
    }
  }
  return pieces.join('\n').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'الطريقة دي مش مدعومة.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes('PASTE_') || apiKey === 'your_api_key_here') {
    return sendJson(res, 503, {
      error: 'مفتاح OpenAI API مش متضاف في Vercel Environment Variables.',
    });
  }

  const contentLength = Number(req.headers?.['content-length'] || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return sendJson(res, 413, { error: 'حجم الرسالة كبير جدًا.' });
  }

  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    if (error?.code === 'BODY_TOO_LARGE') {
      return sendJson(res, 413, { error: 'حجم الرسالة كبير جدًا.' });
    }
    return sendJson(res, 400, { error: 'بيانات الطلب غير سليمة.' });
  }

  if (!Array.isArray(body?.messages) || body.messages.length === 0) {
    return sendJson(res, 400, { error: 'مفيش رسائل للإرسال.' });
  }

  const messages = body.messages.slice(-MAX_MESSAGES).map((message) => {
    const role = message?.role === 'assistant' || message?.role === 'user'
      ? message.role
      : null;
    const content = typeof message?.content === 'string'
      ? message.content.trim().slice(0, MAX_MESSAGE_CHARS)
      : '';
    return role && content ? { role, content } : null;
  }).filter(Boolean);

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return sendJson(res, 400, {
      error: 'آخر رسالة لازم تكون رسالة من المستخدم.',
    });
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        instructions: 'أنت Inno Code، مساعد ذكي وودود. أجب بلغة المستخدم، واستخدم اللهجة المصرية بشكل طبيعي عندما يكتب المستخدم بالعربية المصرية. كن واضحًا ومفيدًا. هذا التطبيق للكتابة فقط ولا تستخدم الصوت.',
        input: messages,
        max_output_tokens: 1200,
        store: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return sendJson(res, 504, {
        error: 'الرد اتأخر من خدمة OpenAI. جرّب تبعت رسالتك تاني.',
      });
    }
    return sendJson(res, 502, {
      error: 'مش قادر أوصل لخدمة OpenAI. اتأكد من الاتصال وحاول تاني.',
    });
  } finally {
    clearTimeout(timeout);
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return sendJson(res, 502, {
      error: 'وصل رد غير مفهوم من خدمة OpenAI. جرّب تاني.',
    });
  }

  if (!upstream.ok) {
    const apiMessage = typeof data?.error?.message === 'string'
      ? data.error.message
      : '';
    let friendly = 'حصل خطأ من OpenAI. راجع إعدادات حساب API وحاول تاني.';

    if (upstream.status === 401) {
      friendly = 'مفتاح API غير صحيح أو اتلغى. راجعه في Vercel Environment Variables.';
    } else if (upstream.status === 429) {
      friendly = 'طلبات كتير أو مفيش رصيد/حد استخدام متاح. راجع Usage وBilling في حساب API.';
    } else if (upstream.status === 400 && /model/i.test(apiMessage)) {
      friendly = `الموديل المحدد (${model}) مش متاح للمفتاح ده. غيّر OPENAI_MODEL لموديل متاح في حسابك.`;
    }

    return sendJson(res, 502, { error: friendly });
  }

  const reply = extractOutputText(data);
  if (!reply) {
    return sendJson(res, 502, {
      error: 'وصل رد من OpenAI لكن مفيهوش نص قابل للعرض.',
    });
  }

  return sendJson(res, 200, { reply, model });
}
