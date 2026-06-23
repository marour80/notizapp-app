/*
 * NZNative – Brücke zu den nativen Capacitor-Funktionen (nur in der Handy-App aktiv).
 * Im Browser/Desktop sind alle Funktionen still inaktiv (graceful fallback).
 *
 * Zugriff auf Plugins über window.Capacitor.Plugins – kein Bundler nötig.
 */
(function (global) {
  function cap() {
    return global.Capacitor;
  }
  function isNative() {
    return !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
  }
  function plugin(name) {
    return cap() && cap().Plugins ? cap().Plugins[name] : null;
  }

  function parseCode(raw) {
    const v = (raw || '').trim();
    const m = v.match(/(?:join|code)=([^&\s]+)/i);
    return decodeURIComponent(m ? m[1] : v).trim().toUpperCase();
  }

  function isAuthCallback(url) {
    return /login-callback/i.test(url || '');
  }

  // Tiefen-Link: smartnote://join?code=XXX → ruft handler(code). Login-Rückleitung wird ignoriert.
  function onDeepLink(handler) {
    const App = plugin('App');
    if (!App) return;
    App.addListener('appUrlOpen', (data) => {
      const url = (data && data.url) || '';
      if (isAuthCallback(url)) return; // OAuth → onAuthCallback
      const code = parseCode(url);
      if (code) handler(code);
    });
    // Falls die App per Link aus dem kalten Zustand gestartet wurde:
    if (App.getLaunchUrl) {
      App.getLaunchUrl()
        .then((res) => {
          if (res && res.url && !isAuthCallback(res.url)) {
            const c = parseCode(res.url);
            if (c) handler(c);
          }
        })
        .catch(() => {});
    }
  }

  // Login-Rückleitung smartnote://login-callback?code=… → ruft handler(url).
  function onAuthCallback(handler) {
    const App = plugin('App');
    if (!App) return;
    App.addListener('appUrlOpen', (data) => {
      const url = (data && data.url) || '';
      if (isAuthCallback(url)) handler(url);
    });
    if (App.getLaunchUrl) {
      App.getLaunchUrl()
        .then((res) => {
          if (res && res.url && isAuthCallback(res.url)) handler(res.url);
        })
        .catch(() => {});
    }
  }

  // Ist ein nativer QR-Scanner verfügbar?
  function scanAvailable() {
    return !!plugin('BarcodeScanning');
  }

  // QR-Code mit der Kamera scannen → liefert den Rohwert (Code/Link).
  async function scanQR() {
    const BS = plugin('BarcodeScanning');
    if (!BS || !BS.scan) throw new Error('no-scanner');
    try {
      if (BS.requestPermissions) await BS.requestPermissions();
    } catch {}
    const res = await BS.scan();
    const list = (res && res.barcodes) || [];
    return list.length ? list[0].rawValue || list[0].displayValue || '' : '';
  }

  // ---- Externen Browser öffnen (für OAuth-Login) ----
  // iOS: window.open('_system') öffnet nichts → Capacitor-Browser-Plugin nutzen.
  async function openUrl(url) {
    const B = plugin('Browser');
    if (B && B.open) {
      try {
        await B.open({ url });
        return true;
      } catch {}
    }
    try {
      global.open(url, '_system');
    } catch {}
    return false;
  }
  async function closeBrowser() {
    const B = plugin('Browser');
    if (B && B.close) {
      try {
        await B.close();
      } catch {}
    }
  }

  // ---- Kamera / Foto ----
  function cameraAvailable() {
    return !!plugin('Camera');
  }

  // Foto aufnehmen ODER aus Galerie wählen (nativer Dialog). Liefert eine DataURL.
  // Wirft 'no-camera', wenn kein Plugin da ist; bei Abbruch eine Fehlermeldung mit "cancel".
  async function takePhoto(labels) {
    const Camera = plugin('Camera');
    if (!Camera || !Camera.getPhoto) throw new Error('no-camera');
    const l = labels || {};
    const photo = await Camera.getPhoto({
      quality: 50,
      width: 900,
      resultType: 'dataUrl', // direkt als data:image/...;base64 → passt in die Notiz
      source: 'PROMPT', // fragt: Foto aufnehmen / Aus Galerie
      correctOrientation: true,
      saveToGallery: false,
      promptLabelHeader: l.header,
      promptLabelPicture: l.camera,
      promptLabelPhoto: l.gallery,
      promptLabelCancel: l.cancel
    });
    return photo && photo.dataUrl;
  }

  // ---- Push (Teil 2) ----
  // Registriert das Gerät für Push und liefert den FCM-Token via onToken(token).
  async function registerPush(onToken) {
    const Push = plugin('PushNotifications');
    if (!Push) return false;
    const perm = await Push.requestPermissions();
    if (perm.receive !== 'granted') return false;
    Push.addListener('registration', (t) => onToken && onToken(t.value));
    Push.addListener('registrationError', (e) => console.warn('[Push] Fehler:', e));
    await Push.register();
    return true;
  }

  global.NZNative = { isNative, onDeepLink, onAuthCallback, scanAvailable, scanQR, cameraAvailable, takePhoto, openUrl, closeBrowser, registerPush, parseCode, plugin };
})(typeof window !== 'undefined' ? window : globalThis);
