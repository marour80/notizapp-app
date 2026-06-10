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

  // Tiefen-Link: notizapp://join?code=XXX → ruft handler(code).
  function onDeepLink(handler) {
    const App = plugin('App');
    if (!App) return;
    App.addListener('appUrlOpen', (data) => {
      const code = parseCode(data && data.url);
      if (code) handler(code);
    });
    // Falls die App per Link aus dem kalten Zustand gestartet wurde:
    if (App.getLaunchUrl) {
      App.getLaunchUrl()
        .then((res) => {
          if (res && res.url) {
            const c = parseCode(res.url);
            if (c) handler(c);
          }
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

  global.NZNative = { isNative, onDeepLink, scanAvailable, scanQR, registerPush, parseCode, plugin };
})(typeof window !== 'undefined' ? window : globalThis);
