const DEFAULT_MODEL = 'gpt-6.2-sol';
const MAX_BODY_BYTES = 160_000;
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 10_000;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function getOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }
  const parts = [];
  for (const item of Array.isArray(data?.output) ? data.output : []) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const block of item.content) {
      if (block?.type === 'output_text' && typeof block.text === 'string') parts.push(block.text);
      if (block?.type === 'refusal' && typeof block.refusal === 'string') parts.push(block.refusal);
    }
  }
  return parts.join('\n').trim();
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json({ error: 'الطريقة دي مش مدعومة.' }, 405);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.includes('PASTE_') || apiKey === 'your_api_key_here') {
    return json({ error: 'مفتاح OpenAI API مش متضاف في Vercel Environment Variables.' }, 503);
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: 'حجم الرسالة كبير جدًا.' }, 413);
  }

  let body;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return json({ error: 'حجم الرسالة كبير جدًا.' }, 413);
    }
    body = JSON.parse(raw || '{}');
  } catch {
    return json({ error: 'بيانات الطلب غير سليمة.' }, 400);
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return json({ error: 'مفيش رسائل للإرسال.' }, 400);
  }

  const messages = body.messages.slice(-MAX_MESSAGES).map((message) => {
    const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : null;
    const content = typeof message?.content === 'string' ? message.content.trim().slice(0, MAX_MESSAGE_CHARS) : '';
    return role && content ? { role, content } : null;
  }).filter(Boolean);

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return json({ error: 'آخر رسالة لازم تكون رسالة من المستخدم.' }, 400);
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
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
    });
  } catch {
    return json({ error: 'مش قادر أوصل لخدمة OpenAI. اتأكد من اتصال الخدمة وحاول تاني.' }, 502);
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const apiMessage = typeof data?.error?.message === 'string' ? data.error.message : '';
    let friendly = 'حصل خطأ من OpenAI. راجع إعدادات حساب API وحاول تاني.';
    if (upstream.status === 401) friendly = 'مفتاح API غير صحيح أو اتلغى. راجعه في Vercel Environment Variables.';
    else if (upstream.status === 429) friendly = 'طلبات كتير أو مفيش رصيد/حد استخدام متاح. راجع Usage وBilling في حساب API.';
    else if (upstream.status === 400 && /model/i.test(apiMessage)) friendly = `الموديل المحدد (${model}) مش متاح للمفتاح ده. غيّر OPENAI_MODEL لموديل متاح في حسابك.`;
    return json({ error: friendly }, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502);
  }

  const reply = getOutputText(data);
  if (!reply) return json({ error: 'وصل رد من OpenAI لكن مفيهوش نص قابل للعرض.' }, 502);
  return json({ reply, model });
}
