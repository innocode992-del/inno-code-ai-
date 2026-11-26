(() => {
  'use strict';

  // Inno Code UI. API requests go to a Vercel serverless function; never place secrets in this file.

  const $ = (id) => document.getElementById(id);
  const KEYS = { chats: 'inno_code_design_chats_v1', theme: 'inno_code_design_theme_v1' };
  const ui = {
    sidebar: $('sidebar'), scrim: $('mobileScrim'), newChat: $('newChatBtn'), history: $('historyList'),
    welcome: $('welcome'), messages: $('messages'), form: $('chatForm'), input: $('messageInput'), send: $('sendBtn'),
    settings: $('settingsModal'), toast: $('toast'), status: $('connectionStatus')
  };
  let chats = read(KEYS.chats, []);
  let activeId = chats[0]?.id || null;
  let toastTimer;

  function read(key, fallback) {
    try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; }
    catch { return fallback; }
  }
  function save() { localStorage.setItem(KEYS.chats, JSON.stringify(chats)); }
  function makeId() { return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
  function activeChat() { return chats.find(chat => chat.id === activeId) || null; }
  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2200);
  }
  function escapeText(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }
  function titleFor(text) {
    const clean = text.trim().replace(/\s+/g, ' ');
    return clean.length > 29 ? `${clean.slice(0, 29)}…` : clean || 'محادثة جديدة';
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
    [...chats].sort((a,b) => b.updatedAt - a.updatedAt).forEach(chat => {
      const button = document.createElement('button');
      button.className = `history-item${chat.id === activeId ? ' selected' : ''}`;
      button.type = 'button';
      const bullet = document.createElement('b'); bullet.className = 'history-bullet'; bullet.textContent = '·';
      const label = document.createElement('span'); label.textContent = chat.title;
      button.append(bullet, label);
      button.addEventListener('click', () => { activeId = chat.id; render(); closeSidebar(); });
      ui.history.append(button);
    });
  }
  function appendMessage(role, content) {
    const article = document.createElement('article');
    article.className = `message ${role}`;
    const avatar = document.createElement('div'); avatar.className = 'message-avatar'; avatar.textContent = role === 'user' ? 'أنت' : 'IN';
    const body = document.createElement('div'); body.className = 'message-body';
    const name = document.createElement('div'); name.className = 'message-name'; name.textContent = role === 'user' ? 'أنت' : 'Inno Code';
    const bubble = document.createElement('div'); bubble.className = 'message-bubble'; bubble.textContent = content;
    body.append(name, bubble);
    const actions = document.createElement('div'); actions.className = 'message-actions';
    const copy = document.createElement('button'); copy.className = 'message-action'; copy.type = 'button'; copy.textContent = 'نسخ';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(content); showToast('تم نسخ النص'); }
      catch { showToast('النسخ غير متاح في المتصفح ده'); }
    });
    actions.append(copy); body.append(actions); article.append(avatar, body); ui.messages.append(article);
  }
  function render() {
    renderHistory();
    ui.messages.replaceChildren();
    const chat = activeChat();
    const hasMessages = Boolean(chat?.messages?.length);
    ui.welcome.hidden = hasMessages;
    ui.messages.classList.toggle('visible', hasMessages);
    if (hasMessages) chat.messages.forEach(message => appendMessage(message.role, message.content));
    requestAnimationFrame(() => {
      const stage = $('conversation'); stage.scrollTop = stage.scrollHeight;
    });
  }
  function createChat() {
    activeId = null;
    ui.input.value = '';
    resizeInput();
    render();
    ui.input.focus();
    closeSidebar();
  }
  function ensureChat(firstMessage) {
    let chat = activeChat();
    if (!chat) {
      chat = { id: makeId(), title: titleFor(firstMessage), updatedAt: Date.now(), messages: [] };
      chats.unshift(chat); activeId = chat.id;
    }
    return chat;
  }

  async function requestAssistantReply(messages) {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.slice(-24).map(({ role, content }) => ({ role, content })) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `حصل خطأ في الاتصال (${response.status})`);
    if (!data.reply) throw new Error('وصل رد فاضي من الخدمة. جرّب مرة تانية.');
    return data.reply;
  }

  async function checkApiStatus() {
    if (!ui.status) return;
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      ui.status.textContent = data.configured ? 'متصل بالذكاء الاصطناعي' : 'مفتاح API غير مضاف';
      ui.status.classList.toggle('api-connected', Boolean(data.configured));
    } catch {
      ui.status.textContent = 'تعذر الوصول لخدمة Inno Code';
      ui.status.classList.remove('api-connected');
    }
  }

  async function sendMessage(value) {
    const text = String(value || '').trim();
    if (!text || ui.send.disabled) return;
    const chat = ensureChat(text);
    chat.messages.push({ role: 'user', content: text });
    chat.title = chat.messages.length === 1 ? titleFor(text) : chat.title;
    chat.updatedAt = Date.now();
    save(); render();
    ui.input.value = ''; resizeInput(); ui.send.disabled = true;
    try {
      const reply = await requestAssistantReply(chat.messages);
      chat.messages.push({ role: 'assistant', content: reply });
    } catch (error) {
      const message = error && error.message ? error.message : 'تعذر الاتصال بالـ API. راجع إعداداتك وحاول تاني.';
      chat.messages.push({ role: 'assistant', content: `معلش، حصلت مشكلة: ${message}` });
      showToast('حصلت مشكلة في الاتصال');
    } finally {
      chat.updatedAt = Date.now(); save(); render();
      ui.send.disabled = !ui.input.value.trim();
      ui.input.focus();
      checkApiStatus();
    }
  }
  function resizeInput() {
    ui.input.style.height = 'auto';
    ui.input.style.height = `${Math.min(ui.input.scrollHeight, 180)}px`;
    ui.send.disabled = !ui.input.value.trim();
  }
  function openSettings() { ui.settings.classList.add('open'); ui.settings.setAttribute('aria-hidden','false'); }
  function closeSettings() { ui.settings.classList.remove('open'); ui.settings.setAttribute('aria-hidden','true'); }
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
  $('modelSwitch').addEventListener('click', () => showToast('الموديل بيتحدد من إعدادات Vercel'));
  checkApiStatus();
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); createChat(); }
    if (event.key === 'Escape') { closeSettings(); closeSidebar(); }
  });

  setTheme(localStorage.getItem(KEYS.theme) || 'light');
  render();
})();
