(() => {
  'use strict';

  // Inno Code UI. All API secrets stay inside Vercel serverless functions.
  const $ = (id) => document.getElementById(id);
  const KEYS = { chats: 'inno_code_design_chats_v1', theme: 'inno_code_design_theme_v1' };
  const MAX_FILES = 4;
  const MAX_TOTAL_FILE_BYTES = 2_500_000;
  const MAX_TEXT_FILE_BYTES = 500_000;

  const ui = {
    sidebar: $('sidebar'), scrim: $('mobileScrim'), newChat: $('newChatBtn'), history: $('historyList'),
    welcome: $('welcome'), messages: $('messages'), form: $('chatForm'), input: $('messageInput'), send: $('sendBtn'),
    settings: $('settingsModal'), toast: $('toast'), status: $('connectionStatus'),
    attachButton: $('attachButton'), attachmentMenu: $('attachmentMenu'), fileInput: $('fileInput'),
    attachmentTray: $('attachmentTray'), micButton: $('micButton'),
    recordingStatus: $('recordingStatus'), recordingStatusText: $('recordingStatusText'), stopRecordingButton: $('stopRecordingButton')
  };

  let chats = read(KEYS.chats, []);
  let activeId = chats[0]?.id || null;
  let toastTimer;
  let pendingFiles = [];
  let recognition = null;
  let isRecording = false;
  let speechText = '';
  let speechUtterance = null;
  let isSending = false;

  function read(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
    catch { return fallback; }
  }
  function save() {
    try { localStorage.setItem(KEYS.chats, JSON.stringify(chats)); }
    catch { showToast('مساحة حفظ المحادثات في المتصفح ممتلئة.'); }
  }
  function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
  function activeChat() { return chats.find(chat => chat.id === activeId) || null; }
  function showToast(message, duration = 2800) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), duration);
  }
  function titleFor(text) {
    const clean = text.trim().replace(/\s+/g, ' ');
    return clean.length > 29 ? `${clean.slice(0, 29)}…` : clean || 'محادثة جديدة';
  }
  function formatSize(bytes) {
    return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }
  function renderHistory() {
    ui.history.replaceChildren();
    if (!chats.length) {
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = 'محادثاتك الجديدة هتظهر هنا';
      ui.history.append(empty);
      return;
    }
    [...chats].sort((a, b) => b.updatedAt - a.updatedAt).forEach(chat => {
      const button = document.createElement('button');
      button.className = `history-item${chat.id === activeId ? ' selected' : ''}`;
      button.type = 'button';
      const bullet = document.createElement('b'); bullet.className = 'history-bullet'; bullet.textContent = '·';
      const label = document.createElement('span'); label.textContent = chat.title;
      button.append(bullet, label);
      button.addEventListener('click', () => { stopSpeech(); activeId = chat.id; render(); closeSidebar(); });
      ui.history.append(button);
    });
  }

  function getCodeBlocks(content) {
    const blocks = [];
    const expression = /```([a-zA-Z0-9_+.#-]*)\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = expression.exec(content)) !== null) {
      const language = (match[1] || 'txt').toLowerCase();
      const extensionMap = {
        html: 'html', htm: 'html', css: 'css', scss: 'scss', js: 'js', javascript: 'js',
        mjs: 'mjs', ts: 'ts', typescript: 'ts', jsx: 'jsx', tsx: 'tsx', json: 'json',
        python: 'py', py: 'py', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs',
        cs: 'cs', php: 'php', sql: 'sql', bash: 'sh', sh: 'sh', shell: 'sh',
        markdown: 'md', md: 'md', xml: 'xml', yaml: 'yml', yml: 'yml', txt: 'txt'
      };
      blocks.push({ language, extension: extensionMap[language] || 'txt', content: match[2].replace(/\n$/, '') });
    }
    return blocks;
  }
  function addButton(container, label, handler, title = '') {
    const button = document.createElement('button');
    button.className = 'message-action';
    button.type = 'button';
    button.textContent = label;
    if (title) button.title = title;
    button.addEventListener('click', handler);
    container.append(button);
    return button;
  }
  function appendAttachmentLabels(container, attachments) {
    if (!Array.isArray(attachments) || !attachments.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'message-attachments';
    attachments.forEach(item => {
      const chip = document.createElement('span');
      chip.className = 'message-attachment-chip';
      chip.textContent = `📎 ${item.name || 'ملف مرفق'}`;
      wrap.append(chip);
    });
    container.append(wrap);
  }
  function appendMessage(role, content, attachments = []) {
    const article = document.createElement('article');
    article.className = `message ${role}`;
    const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = role === 'user' ? 'أنت' : 'IN';
    const body = document.createElement('div'); body.className = 'message-body';
    const name = document.createElement('div'); name.className = 'message-name'; name.textContent = role === 'user' ? 'أنت' : 'Inno Code';
    const bubble = document.createElement('div'); bubble.className = 'message-bubble'; bubble.textContent = content;
    body.append(name, bubble);
    appendAttachmentLabels(body, attachments);

    const actions = document.createElement('div'); actions.className = 'message-actions';
    addButton(actions, 'نسخ', async () => {
      try { await navigator.clipboard.writeText(content); showToast('تم نسخ النص'); }
      catch { showToast('النسخ غير متاح في المتصفح ده'); }
    });

    if (role === 'assistant') {
      const speakButton = addButton(actions, '🔊 قراءة', () => toggleSpeech(content, speakButton), 'قراءة الرد بصوت عربي');
      speakButton.classList.add('speech-toggle');
      addButton(actions, 'إيقاف الصوت', stopSpeech, 'إيقاف القراءة الصوتية');
      addButton(actions, '⬇ تنزيل TXT', () => downloadText(content, 'inno-code-reply.txt'), 'تنزيل الرد كملف نصي');
      addButton(actions, '⬇ تنزيل Word', () => downloadDocx(content, 'inno-code-reply.docx'), 'تنزيل الرد كمستند Word');
      addButton(actions, 'حفظ PDF', () => printAsPdf(content), 'فتح نافذة الطباعة لاختيار حفظ PDF');
      const blocks = getCodeBlocks(content);
      blocks.forEach((block, index) => {
        const filename = `inno-code-${index + 1}.${block.extension}`;
        addButton(actions, `تنزيل ${filename}`, () => downloadText(block.content, filename));
      });
      if (blocks.length) {
        addButton(actions, 'ZIP للكود', () => downloadZip(blocks.map((block, index) => ({
          name: `inno-code-${index + 1}.${block.extension}`,
          content: block.content
        })), 'inno-code-files.zip'));
      }
    }
    body.append(actions);
    article.append(avatar, body);
    ui.messages.append(article);
  }

  function render() {
    renderHistory();
    ui.messages.replaceChildren();
    const chat = activeChat();
    const hasMessages = Boolean(chat?.messages?.length);
    ui.welcome.hidden = hasMessages;
    ui.messages.classList.toggle('visible', hasMessages);
    if (hasMessages) chat.messages.forEach(message => appendMessage(message.role, message.content, message.attachments));
    requestAnimationFrame(() => {
      const stage = $('conversation');
      if (stage) stage.scrollTop = stage.scrollHeight;
    });
  }
  function createChat() {
    stopSpeech();
    activeId = null;
    ui.input.value = '';
    clearPendingFiles();
    resizeInput();
    render();
    ui.input.focus();
    closeSidebar();
  }
  function ensureChat(firstMessage) {
    let chat = activeChat();
    if (!chat) {
      chat = { id: makeId(), title: titleFor(firstMessage), updatedAt: Date.now(), messages: [] };
      chats.unshift(chat);
      activeId = chat.id;
    }
    return chat;
  }

  function guessMime(file) {
    const extension = file.name.split('.').pop().toLowerCase();
    const byExtension = ({ pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
      json: 'application/json', html: 'text/html', htm: 'text/html', css: 'text/css',
      js: 'text/javascript', mjs: 'text/javascript', ts: 'text/plain', xml: 'application/xml',
      log: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      webp: 'image/webp', gif: 'image/gif' })[extension];
    return file.type && (fileKind(file.type) || file.type === 'application/pdf') ? file.type : (byExtension || file.type || 'application/octet-stream');
  }
  function fileKind(mimeType) {
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) return 'image';
    if (mimeType === 'application/pdf') return 'pdf';
    if (['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html', 'text/css',
      'text/javascript', 'application/javascript', 'application/xml', 'text/xml'].includes(mimeType)) return 'text';
    return null;
  }
  function renderPendingFiles() {
    ui.attachmentTray.replaceChildren();
    ui.attachmentTray.hidden = pendingFiles.length === 0;
    pendingFiles.forEach((item, index) => {
      const chip = document.createElement('div');
      chip.className = 'pending-file';
      const label = document.createElement('span');
      label.textContent = `${item.kind === 'image' ? '🖼️' : item.kind === 'pdf' ? '📕' : '📄'} ${item.name} · ${formatSize(item.size)}`;
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'remove-file'; remove.textContent = '×';
      remove.setAttribute('aria-label', `إزالة ${item.name}`);
      remove.addEventListener('click', () => { pendingFiles.splice(index, 1); renderPendingFiles(); resizeInput(); });
      chip.append(label, remove);
      ui.attachmentTray.append(chip);
    });
    resizeInput();
  }
  function clearPendingFiles() {
    pendingFiles = [];
    renderPendingFiles();
  }
  async function acceptFiles(fileList) {
    const incoming = [...fileList];
    if (!incoming.length) return;
    let total = pendingFiles.reduce((sum, item) => sum + item.size, 0);
    for (const file of incoming) {
      if (pendingFiles.length >= MAX_FILES) { showToast(`الحد الأقصى ${MAX_FILES} ملفات في الرسالة.`); break; }
      const mimeType = guessMime(file);
      const kind = fileKind(mimeType);
      if (!kind) { showToast(`نوع الملف غير مدعوم: ${file.name}`); continue; }
      if (file.size <= 0) { showToast(`الملف فارغ: ${file.name}`); continue; }
      if (file.size > MAX_TEXT_FILE_BYTES && kind === 'text') { showToast('حجم الملف النصي أكبر من 500 KB.'); continue; }
      if (file.size > MAX_TOTAL_FILE_BYTES) { showToast('الملف أكبر من الحد المسموح (2.5 MB).'); continue; }
      if (total + file.size > MAX_TOTAL_FILE_BYTES) { showToast('إجمالي المرفقات لا يمكن أن يتجاوز 2.5 MB.'); break; }
      pendingFiles.push({ file, name: file.name, mimeType, kind, size: file.size });
      total += file.size;
    }
    ui.fileInput.value = '';
    ui.attachmentMenu.hidden = true;
    ui.attachButton.setAttribute('aria-expanded', 'false');
    renderPendingFiles();
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error(`تعذرت قراءة الملف ${file.name}`));
      reader.readAsDataURL(file);
    });
  }
  async function prepareAttachments() {
    const prepared = [];
    for (const item of pendingFiles) {
      if (item.kind === 'text') {
        const text = await item.file.text();
        prepared.push({ name: item.name, mimeType: item.mimeType, text });
      } else {
        prepared.push({ name: item.name, mimeType: item.mimeType, data: await fileToBase64(item.file) });
      }
    }
    return prepared;
  }

  async function requestAssistantReply(messages, attachments) {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: messages.slice(-18).map(({ role, content }) => ({ role, content })),
        attachments
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `حصل خطأ في الاتصال (${response.status})`);
    if (!data.reply) throw new Error('وصل رد فاضي من الخدمة. جرّب مرة تانية.');
    return data.reply;
  }
  async function checkApiStatus() {
    if (!ui.status) return;
    try {
      const response = await fetch('/api/status', { cache: 'no-store' });
      const data = await response.json();
      ui.status.textContent = data.configured ? 'مفتاح Gemini مُضاف' : 'مفتاح Gemini غير مضاف';
      ui.status.classList.toggle('api-connected', Boolean(data.configured));
    } catch {
      ui.status.textContent = 'تعذر فحص إعدادات Inno Code';
      ui.status.classList.remove('api-connected');
    }
  }
  async function sendMessage(value) {
    const typedText = String(value || '').trim();
    if ((!typedText && !pendingFiles.length) || isSending) return;
    isSending = true;
    ui.send.disabled = true;
    const text = typedText || 'حلّل الملفات المرفقة واشرح لي محتواها.';
    const attachments = await prepareAttachments().catch(error => {
      showToast(error.message || 'تعذرت قراءة المرفقات.');
      return null;
    });
    if (attachments === null) { isSending = false; resizeInput(); return; }
    const metadata = pendingFiles.map(item => ({ name: item.name, mimeType: item.mimeType, size: item.size }));
    const chat = ensureChat(text);
    chat.messages.push({ role: 'user', content: text, attachments: metadata });
    chat.title = chat.messages.length === 1 ? titleFor(text) : chat.title;
    chat.updatedAt = Date.now();
    save();
    clearPendingFiles();
    render();
    ui.input.value = ''; resizeInput(); ui.send.disabled = true;
    try {
      const reply = await requestAssistantReply(chat.messages, attachments);
      chat.messages.push({ role: 'assistant', content: reply });
    } catch (error) {
      const message = error && error.message ? error.message : 'تعذر الاتصال بالـ API. راجع إعداداتك وحاول تاني.';
      chat.messages.push({ role: 'assistant', content: `معلش، حصلت مشكلة: ${message}` });
      showToast('حصلت مشكلة في الاتصال');
    } finally {
      chat.updatedAt = Date.now(); save(); render();
      isSending = false;
      resizeInput();
      ui.input.focus();
      checkApiStatus();
    }
  }
  function resizeInput() {
    ui.input.style.height = 'auto';
    ui.input.style.height = `${Math.min(ui.input.scrollHeight, 180)}px`;
    ui.send.disabled = !ui.input.value.trim() && pendingFiles.length === 0;
  }

  // Speech recognition is started only from the user's tap. Text stays in the composer for review.
  let recordingBaseText = '';
  let recordingFinalText = '';
  let recordingHadError = false;

  function resetRecordingUI() {
    isRecording = false;
    ui.micButton.classList.remove('recording');
    ui.micButton.innerHTML = '<span class="tool-symbol" aria-hidden="true">🎙️</span><span class="tool-label">تسجيل</span>';
    ui.micButton.setAttribute('aria-label', 'ابدأ تسجيل الكلام وتحويله إلى نص');
    ui.micButton.title = 'ابدأ تسجيل الكلام وتحويله إلى نص';
    ui.recordingStatus.hidden = true;
  }

  function stopRecording() {
    const current = recognition;
    if (current && isRecording) {
      try { current.stop(); } catch { /* It may already have stopped. */ }
    }
    resetRecordingUI();
  }

  function startRecording() {
    if (isRecording) { stopRecording(); return; }
    if (!window.isSecureContext) {
      showToast('لازم تفتح Inno Code من رابط HTTPS عشان المتصفح يسمح باستخدام الميكروفون.', 6000);
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      showToast('المتصفح ده لا يدعم تحويل الكلام إلى نص من داخل الموقع. جرّب Chrome على Android، أو استخدم ميكروفون لوحة مفاتيح الموبايل.', 7500);
      return;
    }

    try {
      const current = new Recognition();
      recognition = current;
      recordingBaseText = ui.input.value.trim();
      recordingFinalText = '';
      recordingHadError = false;
      current.lang = 'ar-EG';
      current.interimResults = true;
      current.continuous = true;
      current.maxAlternatives = 1;

      current.onstart = () => {
        isRecording = true;
        ui.micButton.classList.add('recording');
        ui.micButton.innerHTML = '<span class="tool-symbol" aria-hidden="true">■</span><span class="tool-label">إيقاف</span>';
        ui.micButton.setAttribute('aria-label', 'إيقاف التسجيل');
        ui.micButton.title = 'إيقاف التسجيل';
        ui.recordingStatus.hidden = false;
        ui.recordingStatusText.textContent = 'جاري الاستماع بالعربية… اتكلم دلوقتي';
        showToast('بدأ التسجيل. اتكلم، ثم اضغط «إيقاف» لمراجعة النص.', 5000);
      };

      current.onresult = event => {
        let interim = '';
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const result = event.results[index];
          const phrase = result?.[0]?.transcript || '';
          if (result.isFinal) recordingFinalText += `${phrase} `;
          else interim += phrase;
        }
        const recognized = [recordingBaseText, recordingFinalText.trim(), interim.trim()].filter(Boolean).join(' ').trim();
        ui.input.value = recognized;
        resizeInput();
        ui.recordingStatusText.textContent = interim.trim() ? `سمعت: ${interim.trim()}` : 'جاري الاستماع… تقدر تكمل كلامك';
      };

      current.onerror = event => {
        recordingHadError = true;
        const errors = {
          'not-allowed': 'إذن الميكروفون مرفوض. افتح إعدادات الموقع واسمح باستخدام الميكروفون.',
          'service-not-allowed': 'خدمة تحويل الكلام غير مسموح بها في إعدادات المتصفح.',
          'no-speech': 'لم أسمع كلامًا. اضغط تسجيل وابدأ الكلام بالقرب من الميكروفون.',
          'audio-capture': 'لم أجد ميكروفونًا متصلًا أو متاحًا للجهاز.',
          'network': 'خدمة التعرف على الكلام تحتاج اتصال إنترنت. تحقق من الاتصال وحاول مرة أخرى.',
          'aborted': 'تم إيقاف التسجيل.'
        };
        showToast(errors[event.error] || `تعذر تحويل الكلام (${event.error || 'خطأ غير معروف'}). راجع إذن الميكروفون وحاول مجددًا.`, 7000);
      };

      current.onend = () => {
        const gotText = ui.input.value.trim() && ui.input.value.trim() !== recordingBaseText;
        if (recognition === current) recognition = null;
        resetRecordingUI();
        if (gotText && !recordingHadError) {
          showToast('تم تحويل كلامك إلى نص. راجعه وعدّله ثم اضغط إرسال.', 5000);
        }
      };

      current.start();
    } catch (error) {
      recognition = null;
      resetRecordingUI();
      showToast('تعذر بدء التسجيل. تأكد من إذن الميكروفون واستخدم Chrome أو Edge من رابط HTTPS.', 7000);
    }
  }

  // Browser speech synthesis: no live voice session or additional speech API is used.
  function stopSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    speechText = '';
    speechUtterance = null;
    document.querySelectorAll('.speech-toggle').forEach(button => { button.textContent = '🔊 قراءة'; });
  }
  function toggleSpeech(text, button) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      showToast('قراءة الصوت غير مدعومة في المتصفح ده.');
      return;
    }
    const synth = window.speechSynthesis;
    if (speechText === text && speechUtterance && (synth.speaking || synth.paused)) {
      if (synth.paused) { synth.resume(); button.textContent = '⏸ إيقاف مؤقت'; }
      else { synth.pause(); button.textContent = '▶ متابعة'; }
      return;
    }
    synth.cancel();
    speechText = text;
    const utterance = new SpeechSynthesisUtterance(text.slice(0, 20000));
    const voices = synth.getVoices();
    const arabicVoice = voices.find(voice => /^ar-EG$/i.test(voice.lang)) || voices.find(voice => /^ar([_-]|$)/i.test(voice.lang));
    utterance.lang = arabicVoice?.lang || 'ar-EG';
    if (arabicVoice) utterance.voice = arabicVoice;
    utterance.rate = 1;
    utterance.onend = () => { if (speechUtterance === utterance) { speechUtterance = null; speechText = ''; button.textContent = '🔊 قراءة'; } };
    utterance.onerror = () => { if (speechUtterance === utterance) { speechUtterance = null; speechText = ''; button.textContent = '🔊 قراءة'; showToast('تعذرت قراءة الرد بصوت.'); } };
    speechUtterance = utterance;
    button.textContent = '⏸ إيقاف مؤقت';
    synth.speak(utterance);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function downloadText(content, filename) {
    downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), filename);
  }
  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ -1) >>> 0;
  }
  function zipStored(entries) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    entries.forEach(entry => {
      const name = encoder.encode(entry.name);
      const data = entry.bytes || encoder.encode(entry.content || '');
      const checksum = crc32(data);
      const local = new Uint8Array(30 + name.length + data.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true); lv.setUint16(10, 0, true); lv.setUint16(12, 0x21, true);
      lv.setUint32(14, checksum, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
      local.set(name, 30); local.set(data, 30 + name.length);
      localParts.push(local);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true); cv.setUint32(16, checksum, true);
      cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true); central.set(name, 46);
      centralParts.push(central);
      offset += local.length;
    });
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true); ev.setUint16(20, 0, true);
    return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
  }
  function downloadZip(entries, filename) {
    downloadBlob(zipStored(entries), filename);
  }
  function downloadDocx(content, filename) {
    const xmlEscape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
    const paragraphs = String(content).split(/\r?\n/).map(line => `<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:rtl/></w:rPr><w:t xml:space="preserve">${xmlEscape(line || ' ')}</w:t></w:r></w:p>`).join('');
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
    const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const blob = zipStored([
      { name: '[Content_Types].xml', content: types },
      { name: '_rels/.rels', content: rels },
      { name: 'word/document.xml', content: documentXml }
    ]);
    downloadBlob(new Blob([blob], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), filename);
  }
  function printAsPdf(content) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) { showToast('اسمح بفتح النوافذ المنبثقة لحفظ الرد PDF.'); return; }
    printWindow.document.open();
    printWindow.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>Inno Code</title><style>body{font-family:Arial,sans-serif;direction:rtl;text-align:right;white-space:pre-wrap;line-height:1.9;padding:32px;color:#202333}h1{font-size:20px;margin-bottom:24px}@media print{body{padding:0}}</style></head><body><h1>Inno Code</h1><main>${escapeHtml(content)}</main><script>window.onload=()=>setTimeout(()=>window.print(),250);<\/script></body></html>`);
    printWindow.document.close();
  }

  function openSettings() { ui.settings.classList.add('open'); ui.settings.setAttribute('aria-hidden', 'false'); }
  function closeSettings() { ui.settings.classList.remove('open'); ui.settings.setAttribute('aria-hidden', 'true'); }
  function openSidebar() { ui.sidebar.classList.add('open'); ui.scrim.classList.add('open'); }
  function closeSidebar() { ui.sidebar.classList.remove('open'); ui.scrim.classList.remove('open'); }
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(KEYS.theme, theme);
    document.querySelectorAll('[data-theme-choice]').forEach(button => button.classList.toggle('selected', button.dataset.themeChoice === theme));
    const icon = $('themeBtn').querySelector('svg');
    icon.innerHTML = theme === 'dark'
      ? '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"/>'
      : '<path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.64 5.64l1.42 1.42m9.88 9.88 1.42 1.42m0-12.72-1.42 1.42m-9.88 9.88-1.42 1.42"/><circle cx="12" cy="12" r="4"/>';
  }

  ui.form.addEventListener('submit', event => { event.preventDefault(); sendMessage(ui.input.value); });
  ui.input.addEventListener('input', resizeInput);
  ui.input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); ui.form.requestSubmit(); }
  });
  ui.newChat.addEventListener('click', createChat);
  $('homeNav').addEventListener('click', createChat);
  $('searchNav').addEventListener('click', () => {
    const term = prompt('اكتب كلمة للبحث في المحادثات:');
    if (!term) return;
    const found = chats.find(chat => `${chat.title} ${chat.messages.map(m => m.content).join(' ')}`.toLowerCase().includes(term.toLowerCase()));
    if (found) { activeId = found.id; render(); closeSidebar(); }
    else showToast('ملقتش محادثة بالكلمة دي');
  });
  $('historyMenuBtn').addEventListener('click', () => {
    if (!chats.length) return showToast('مفيش محادثات تتمسح');
    if (confirm('تمسح كل المحادثات المحفوظة على الجهاز؟')) { chats = []; activeId = null; save(); render(); showToast('تم مسح المحادثات'); }
  });
  $('settingsBtn').addEventListener('click', openSettings);
  $('closeSettings').addEventListener('click', closeSettings);
  $('doneSettings').addEventListener('click', closeSettings);
  ui.settings.addEventListener('click', event => { if (event.target === ui.settings) closeSettings(); });
  $('clearChats').addEventListener('click', () => {
    if (confirm('متأكد إنك عايز تمسح كل المحادثات؟')) { chats = []; activeId = null; save(); render(); closeSettings(); showToast('تم مسح المحادثات'); }
  });
  $('themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  document.querySelectorAll('[data-theme-choice]').forEach(button => button.addEventListener('click', () => setTheme(button.dataset.themeChoice)));
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => sendMessage(button.dataset.prompt)));
  $('openSidebar').addEventListener('click', openSidebar);
  $('closeSidebar').addEventListener('click', closeSidebar);
  ui.scrim.addEventListener('click', closeSidebar);
  $('modelSwitch').addEventListener('click', () => showToast('موديل المحادثة الحالي يُدار من إعدادات Vercel. توليد الصور غير مفعّل لتجنب أي تكلفة دون موافقتك.'));

  ui.attachButton.addEventListener('click', () => {
    ui.attachmentMenu.hidden = !ui.attachmentMenu.hidden;
    ui.attachButton.setAttribute('aria-expanded', String(!ui.attachmentMenu.hidden));
    if (!ui.attachmentMenu.hidden) showToast('اختار نوع الملف من القائمة اللي ظهرت.');
  });
  ui.attachmentMenu.addEventListener('click', event => {
    const choice = event.target.closest('[data-file-kind]');
    if (!choice) return;
    const kind = choice.dataset.fileKind;
    ui.fileInput.accept = kind === 'image' ? 'image/jpeg,image/png,image/webp,image/gif'
      : kind === 'pdf' ? 'application/pdf,.pdf'
      : kind === 'text' ? '.txt,.md,.csv,.json,.html,.htm,.css,.js,.mjs,.ts,.xml,.log,text/plain,text/markdown,text/csv,application/json,text/html,text/css,text/javascript'
      : 'image/jpeg,image/png,image/webp,image/gif,application/pdf,.txt,.md,.csv,.json,.html,.css,.js,.mjs,.ts,.xml,.log';
    ui.fileInput.click();
  });
  ui.fileInput.addEventListener('change', event => acceptFiles(event.target.files));
  ui.stopRecordingButton.addEventListener('click', stopRecording);
  document.addEventListener('click', event => {
    if (!ui.attachmentMenu.hidden && !event.target.closest('.attachment-tools')) { ui.attachmentMenu.hidden = true; ui.attachButton.setAttribute('aria-expanded', 'false'); }
  });
  ui.micButton.addEventListener('click', startRecording);

  window.addEventListener('inno-pwa-toast', event => {
    if (event.detail) showToast(String(event.detail), 7500);
  });

  checkApiStatus();
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); createChat(); }
    if (event.key === 'Escape') { closeSettings(); closeSidebar(); ui.attachmentMenu.hidden = true; stopRecording(); }
  });

  setTheme(localStorage.getItem(KEYS.theme) || 'light');
  renderPendingFiles();
  render();
})();
