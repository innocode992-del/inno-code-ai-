(() => {
  'use strict';

  const installButton = document.getElementById('installAppBtn');
  if (!installButton) return;

  let installPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.classList.add('install-ready');
    installButton.textContent = 'تثبيت التطبيق';
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installButton.textContent = 'تم التثبيت';
    installButton.disabled = true;
    window.dispatchEvent(new CustomEvent('inno-pwa-toast', { detail: 'تم تثبيت Inno Code على جهازك.' }));
  });

  installButton.addEventListener('click', async () => {
    if (isStandalone()) {
      window.dispatchEvent(new CustomEvent('inno-pwa-toast', { detail: 'Inno Code مثبت بالفعل على جهازك.' }));
      return;
    }

    if (installPrompt) {
      installPrompt.prompt();
      const result = await installPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
      if (result.outcome === 'accepted') {
        window.dispatchEvent(new CustomEvent('inno-pwa-toast', { detail: 'بدأ تثبيت Inno Code على جهازك.' }));
      }
      installPrompt = null;
      return;
    }

    const ua = navigator.userAgent || '';
    let message;
    if (/iPhone|iPad|iPod/i.test(ua)) {
      message = 'على iPhone أو iPad: افتح الموقع في Safari، واضغط مشاركة، ثم «إضافة إلى الشاشة الرئيسية»، وبعدها اضغط «إضافة». ';
    } else if (/Android/i.test(ua)) {
      message = 'على Android: افتح الموقع في Chrome، واضغط قائمة ⋮، ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية». ';
    } else {
      message = 'افتح قائمة المتصفح وابحث عن «تثبيت التطبيق» أو «Install app». ';
    }
    window.dispatchEvent(new CustomEvent('inno-pwa-toast', { detail: message }));
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
        .catch((error) => console.warn('Inno Code offline shell registration failed:', error));
    });
  }
})();
