/**
 * Inno Code - Vercel Node.js Function
 * POST /api/chat
 * Gemini Developer API (Google AI Studio). Keep GEMINI_API_KEY in Vercel Environment Variables.
 */

const DEFAULT_MODEL = 'gemini-3.8-flash';
const MAX_BODY_BYTES = 160_000;
const MAX_MESSAGES = 18;
const MAX_MESSAGE_CHARS = 6_000;
const MAX_TOTAL_CHARS = 24_000;
const GEMINI_TIMEOUT_MS = 45_000;

function sendJson(res, status, payload) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return res.status(status).json(payload);
}

async function readRequestBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    return JSON.parse(req.body || '{}');
  }

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
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function extractGeminiText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const parts = [];
  for (const step of Array.isArray(data?.steps) ? data.steps : []) {
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) continue;
    for (const item of step.content) {
      if (item?.type === 'text' && typeof item.text === 'string') {
        parts.push(item.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function buildConversation(messages) {
  const systemPrompt = [
    'أنت Inno Code، مساعد ذكي وودود للمحادثة بالكتابة فقط.',
    'أجب بلغة المستخدم، واستخدم اللهجة المصرية بشكل طبيعي عندما يكتب المستخدم بالعربية المصرية.',
    'كن واضحًا ومفيدًا، ولا تدّعِ أنك نفذت شيئًا لم تنفذه.',
    'لا تستخدم الصوت أو تطلب من المستخدم إرسال تسجيل صوتي.',
  ].join('\n');

  const transcript = messages.map((message) => {
    const speaker = message.role === 'assistant' ? 'Inno Code' : 'المستخدم';
    return `${speaker}: ${message.content}`;
  }).join('\n\n');

  return `${systemPrompt}\n\nسياق المحادثة:\n${transcript}\n\nInno Code:`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'الطريقة دي مش مدعومة.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.includes('PASTE_') || apiKey === 'your_api_key_here') {
    return sendJson(res, 503, {
      error: 'مفتاح Gemini مش متضاف. أضف GEMINI_API_KEY في Vercel Environment Variables.',
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
    return sendJson(res, 400, { error: 'آخر رسالة لازم تكون رسالة من المستخدم.' });
  }

  let totalChars = 0;
  for (const message of messages) totalChars += message.content.length;
  while (messages.length > 1 && totalChars > MAX_TOTAL_CHARS) {
    totalChars -= messages.shift().content.length;
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: buildConversation(messages),
        store: false,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      return sendJson(res, 504, { error: 'Gemini اتأخر في الرد. جرّب تاني بعد شوية.' });
    }
    return sendJson(res, 502, { error: 'مش قادر أوصل لخدمة Gemini. جرّب تاني.' });
  } finally {
    clearTimeout(timeout);
  }

  let data;
  try {
    data = await upstream.json();
  } catch {
    return sendJson(res, 502, { error: 'وصل رد غير مفهوم من Gemini. جرّب تاني.' });
  }

  if (!upstream.ok) {
    const apiMessage = typeof data?.error?.message === 'string' ? data.error.message : '';
    let friendly = 'حصل خطأ من Gemini. راجع إعدادات Gemini API وحاول تاني.';

    if (upstream.status === 400 && /model/i.test(apiMessage)) {
      friendly = `الموديل (${model}) مش متاح للمفتاح ده. راجع اسم الموديل في GEMINI_MODEL.`;
    } else if (upstream.status === 400) {
      friendly = 'Gemini رفض صيغة الطلب. جرّب تاني أو راجع إعدادات المشروع.';
    } else if (upstream.status === 401 || upstream.status === 403) {
      friendly = 'مفتاح Gemini غير صحيح أو غير مفعّل للمشروع. راجعه في Vercel.';
    } else if (upstream.status === 429) {
      friendly = 'وصلت لحد الطلبات المجاني في Gemini حاليًا. جرّب بعد ما الحد يتجدد.';
    } else if (upstream.status >= 500) {
      friendly = 'خدمة Gemini فيها مشكلة مؤقتة. جرّب تاني بعد شوية.';
    }

    return sendJson(res, 502, { error: friendly });
  }

  const reply = extractGeminiText(data);
  if (!reply) {
    return sendJson(res, 502, { error: 'Gemini رجّع رد من غير نص قابل للعرض.' });
  }

  return sendJson(res, 200, { reply, model, provider: 'Gemini' });
}
