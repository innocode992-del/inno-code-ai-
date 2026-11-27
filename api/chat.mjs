/**
 * Inno Code - Vercel Node.js Function
 * POST /api/chat
 * Uses the Gemini Developer API generateContent endpoint.
 * Keep GEMINI_API_KEY in Vercel Environment Variables only.
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

function normalizeMessages(rawMessages) {
  const messages = rawMessages.slice(-MAX_MESSAGES).map((message) => {
    const role = message?.role === 'assistant' || message?.role === 'user'
      ? message.role
      : null;
    const content = typeof message?.content === 'string'
      ? message.content.trim().slice(0, MAX_MESSAGE_CHARS)
      : '';
    return role && content ? { role, content } : null;
  }).filter(Boolean);

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return { error: 'آخر رسالة لازم تكون رسالة من المستخدم.' };
  }

  let totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  while (messages.length > 1 && totalChars > MAX_TOTAL_CHARS) {
    totalChars -= messages.shift().content.length;
  }

  return { messages };
}

function extractReply(data) {
  const candidate = data?.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts)
    ? candidate.content.parts
    : [];
  return parts
    .filter((part) => typeof part?.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function friendlyProviderError(status, message, model) {
  const lower = String(message || '').toLowerCase();
  if (status === 400 && (lower.includes('model') || lower.includes('not found'))) {
    return `موديل Gemini (${model}) غير متاح لهذا المفتاح. راجع اسم الموديل.`;
  }
  if (status === 400) {
    return `Gemini رفض صيغة الطلب: ${String(message || 'INVALID_ARGUMENT').slice(0, 240)}`;
  }
  if (status === 401 || status === 403) {
    return 'مفتاح Gemini غير صحيح أو ليس لديه صلاحية لهذا المشروع. راجع GEMINI_API_KEY في Vercel.';
  }
  if (status === 404) {
    return `لم يتم العثور على موديل Gemini (${model}) أو أن الواجهة غير متاحة للمشروع.`;
  }
  if (status === 429) {
    return 'وصلت إلى حد الاستخدام أو عدد الطلبات في Gemini. انتظر تجدد الحد ثم جرّب مرة أخرى.';
  }
  if (status >= 500) {
    return 'خدمة Gemini تواجه مشكلة مؤقتة. جرّب مرة أخرى بعد قليل.';
  }
  return `فشل طلب Gemini (HTTP ${status}). ${String(message || '').slice(0, 180)}`;
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

  const normalized = normalizeMessages(body.messages);
  if (normalized.error) return sendJson(res, 400, { error: normalized.error });

  const contents = normalized.messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }));

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  let upstream;
  let rawText;
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: [
              'أنت Inno Code، مساعد ذكي وودود للمحادثة بالكتابة فقط.',
              'أجب بلغة المستخدم، واستخدم اللهجة المصرية بشكل طبيعي عندما يكتب المستخدم بالعربية المصرية.',
              'كن واضحًا ومفيدًا، ولا تدّعِ أنك نفذت شيئًا لم تنفذه.',
              'لا تستخدم الصوت أو تطلب من المستخدم إرسال تسجيل صوتي.',
            ].join('\n'),
          }],
        },
        contents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      }),
      signal: controller.signal,
    });
    rawText = await upstream.text();
  } catch (error) {
    if (error?.name === 'AbortError') {
      return sendJson(res, 504, { error: 'Gemini اتأخر في الرد أكثر من 45 ثانية. جرّب مرة أخرى.' });
    }
    console.error('Gemini network error:', error?.message || 'unknown');
    return sendJson(res, 502, { error: 'السيرفر لم يتمكن من الوصول إلى Gemini. افحص Logs في Vercel.' });
  } finally {
    clearTimeout(timeout);
  }

  let data;
  try {
    data = JSON.parse(rawText || '{}');
  } catch {
    console.error('Gemini returned non-JSON response:', String(rawText || '').slice(0, 300));
    return sendJson(res, 502, { error: 'Gemini أرسل استجابة غير مفهومة. راجع Logs في Vercel.' });
  }

  if (!upstream.ok) {
    const providerMessage = data?.error?.message || data?.error?.status || '';
    console.error('Gemini API request failed:', {
      status: upstream.status,
      message: String(providerMessage).slice(0, 500),
      model,
    });
    return sendJson(res, 502, {
      error: friendlyProviderError(upstream.status, providerMessage, model),
    });
  }

  const reply = extractReply(data);
  if (!reply) {
    const reason = data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || 'NO_TEXT';
    console.error('Gemini returned no text:', { reason, model });
    return sendJson(res, 502, {
      error: `Gemini لم يرجّع نصًا قابلًا للعرض (السبب: ${reason}). جرّب رسالة أخرى.`,
    });
  }

  return sendJson(res, 200, { reply, model, provider: 'Gemini' });
}
