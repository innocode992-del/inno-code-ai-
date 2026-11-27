(() => {
  'use strict';
  const installButtons = [...document.querySelectorAll('#installAppBtn, #installTopBtn')];
  if (!installButtons.length) return;

  let installPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const notify = message => window.dispatchEvent(new CustomEvent('inno-pwa-toast', { detail: message }));
  const setButtons = (label, disabled = false) => installButtons.forEach(button => {
    if (button.id === 'installTopBtn') {
      const labelNode = button.querySelector('b');
      if (labelNode) labelNode.textContent = label === 'تثبيت التطبيق' ? 'تثبيت' : label;
    } else {
      button.textContent = label;
    }
    button.disabled = disabled;
  });

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    installButtons.forEach(button => button.classList.add('install-ready'));
    setButtons('تثبيت التطبيق');
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    setButtons('تم التثبيت', true);
    notify('تم تثبيت Inno Code على جهازك.');
  });

  async function installApp() {
    if (isStandalone()) { notify('Inno Code مثبت بالفعل على جهازك.'); return; }
    if (installPrompt) {
      try {
        await installPrompt.prompt();
        const result = await installPrompt.userChoice;
        if (result?.outcome === 'accepted') notify('بدأ تثبيت Inno Code على جهازك.');
        else notify('لم يتم التثبيت. تقدر تجرب مرة ثانية من زر تثبيت التطبيق.');
      } catch {
        notify('لم تظهر نافذة التثبيت. افتح قائمة المتصفح واختر «تثبيت التطبيق».');
      } finally { installPrompt = null; }
      return;
    }

    const ua = navigator.userAgent || '';
    let message;
    if (/iPhone|iPad|iPod/i.test(ua)) {
      message = 'لتثبيت Inno Code على iPhone: افتح الموقع في Safari، واضغط مشاركة، ثم «إضافة إلى الشاشة الرئيسية»، وبعدها اضغط «إضافة».';
    } else if (/Android/i.test(ua)) {
      message = 'لتثبيت Inno Code على Android: افتح الموقع في Chrome، واضغط قائمة ⋮، ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».';
    } else {
      message = 'افتح قائمة المتصفح وابحث عن «تثبيت التطبيق» أو «Install app». يجب أن يكون الموقع مفتوحًا برابط HTTPS.';
    }
    notify(message);
  }

  installButtons.forEach(button => button.addEventListener('click', installApp));

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .catch(error => console.warn('Inno Code shell registration failed:', error));
    });
  }
})();
