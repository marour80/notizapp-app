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

  // App-interne Routen (z.B. vom Widget): smartnote://voice, smartnote://termine
  function isRouteUrl(url) {
    return /:\/\/(voice|termine)/i.test(url || '');
  }

  // Widget-Tipps & Co.: smartnote://voice → Sprachaufnahme, smartnote://termine → Termine-Tab.
  function onAppRoute(routes) {
    const App = plugin('App');
    if (!App) return;
    const route = (url) => {
      if (!url) return;
      if (/:\/\/voice/i.test(url) && routes.voice) routes.voice();
      else if (/:\/\/termine/i.test(url) && routes.termine) routes.termine();
    };
    App.addListener('appUrlOpen', (d) => route(d && d.url));
    if (App.getLaunchUrl) {
      App.getLaunchUrl()
        .then((r) => route(r && r.url))
        .catch(() => {});
    }
  }

  // Tiefen-Link: smartnote://join?code=XXX → ruft handler(code). Login-Rückleitung wird ignoriert.
  function onDeepLink(handler) {
    const App = plugin('App');
    if (!App) return;
    App.addListener('appUrlOpen', (data) => {
      const url = (data && data.url) || '';
      if (isAuthCallback(url) || isRouteUrl(url)) return; // OAuth → onAuthCallback, Routen → onAppRoute
      const code = parseCode(url);
      if (code) handler(code);
    });
    // Falls die App per Link aus dem kalten Zustand gestartet wurde:
    if (App.getLaunchUrl) {
      App.getLaunchUrl()
        .then((res) => {
          if (res && res.url && !isAuthCallback(res.url) && !isRouteUrl(res.url)) {
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

  // ---- Nativer Audio-Recorder (für iOS – Web-Aufnahme liefert dort stilles Audio) ----
  function isIOS() {
    return !!(cap() && cap().getPlatform && cap().getPlatform() === 'ios');
  }
  function voiceRec() {
    return plugin('VoiceRecorder');
  }
  // Eigenes NZRecorder-Plugin (mit Live-Pegel für die Aufnahme-Animation) – bevorzugt.
  function nzRec() {
    return plugin('NZRecorder');
  }
  function nativeRecordAvailable() {
    return isIOS() && !!(nzRec() || voiceRec());
  }
  async function startNativeRecording() {
    const R = nzRec();
    if (R) {
      try {
        const r = await R.start();
        return !!(r && r.ok);
      } catch {
        return false;
      }
    }
    const VR = voiceRec();
    if (!VR) return false;
    try {
      const perm = await VR.requestAudioRecordingPermission();
      if (perm && perm.value === false) return false;
    } catch {}
    try {
      await VR.startRecording();
      return true;
    } catch {
      return false;
    }
  }
  async function stopNativeRecording() {
    const R = nzRec();
    if (R) {
      try {
        const r = await R.stop();
        if (r && r.ok && r.base64) return { base64: r.base64, mimeType: r.mimeType || 'audio/aac' };
      } catch {}
      return null;
    }
    const VR = voiceRec();
    if (!VR) return null;
    try {
      const res = await VR.stopRecording();
      const v = res && res.value;
      if (v && v.recordDataBase64) return { base64: v.recordDataBase64, mimeType: v.mimeType || 'audio/aac' };
    } catch {}
    return null;
  }
  // Aufnahme verwerfen (Abbrechen) – Ergebnis interessiert nicht.
  async function cancelNativeRecording() {
    const R = nzRec();
    if (R) {
      try { await R.cancel(); } catch {}
      return;
    }
    const VR = voiceRec();
    if (VR) {
      try { await VR.stopRecording(); } catch {}
    }
  }
  // Aktueller Mikrofonpegel 0..1 (nur mit NZRecorder verfügbar, sonst null).
  async function getRecordingLevel() {
    const R = nzRec();
    if (!R) return null;
    try {
      const r = await R.level();
      return r && typeof r.level === 'number' ? r.level : 0;
    } catch {
      return null;
    }
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
  // Nutzt @capacitor-firebase/messaging → liefert auf iOS UND Android einen echten
  // FCM-Token (nicht den rohen APNs-Token, den FCM ablehnt).
  async function registerPush(onToken) {
    const FM = plugin('FirebaseMessaging');
    if (!FM) { console.warn('[Push] FirebaseMessaging-Plugin fehlt'); return false; }
    try {
      const perm = await FM.requestPermissions();
      if (perm && perm.receive && perm.receive !== 'granted') {
        console.warn('[Push] Berechtigung nicht erteilt:', perm.receive);
        return false;
      }
    } catch (e) { console.warn('[Push] requestPermissions:', e); }
    // Falls der Token später neu ausgestellt wird (z. B. nach APNs-Registrierung).
    try {
      FM.addListener('tokenReceived', (ev) => {
        if (onToken && ev && ev.token) onToken(ev.token);
      });
    } catch {}
    try {
      const res = await FM.getToken();
      if (res && res.token && onToken) onToken(res.token);
    } catch (e) {
      console.warn('[Push] getToken:', e);
    }
    return true;
  }

  // ---- Lokale Benachrichtigungen (Termin-Erinnerungen, komplett auf dem Gerät) ----
  function remindersAvailable() {
    return !!plugin('LocalNotifications');
  }
  async function requestReminderPermission() {
    const LN = plugin('LocalNotifications');
    if (!LN) return false;
    try {
      const p = await LN.requestPermissions();
      return !!(p && p.display === 'granted');
    } catch {
      return false;
    }
  }
  // Ersetzt ALLE geplanten Erinnerungen durch die übergebene Liste
  // items: [{ id:int, title, body, at:Date, actionTypeId?, extra? }]
  async function replaceReminders(items) {
    const LN = plugin('LocalNotifications');
    if (!LN) return false;
    try {
      const pending = await LN.getPending();
      const ids = ((pending && pending.notifications) || []).map((n) => ({ id: n.id }));
      if (ids.length) await LN.cancel({ notifications: ids });
    } catch {}
    if (!items || !items.length) return true;
    try {
      await LN.schedule({
        notifications: items.map((it) => {
          const n = {
            id: it.id,
            title: it.title,
            body: it.body,
            schedule: { at: it.at },
            sound: 'default'
          };
          if (it.actionTypeId) n.actionTypeId = it.actionTypeId;
          if (it.extra) n.extra = it.extra;
          return n;
        })
      });
      return true;
    } catch (e) {
      console.warn('[Reminder] schedule fehlgeschlagen:', e);
      return false;
    }
  }

  // Interaktive "Termin vorbei – erledigt?"-Benachrichtigung: registriert die
  // Aktions-Buttons und meldet Antworten (auch aus dem Hintergrund) an onAction.
  async function initTermActions(labels, onAction) {
    const LN = plugin('LocalNotifications');
    if (!LN) return false;
    try {
      await LN.registerActionTypes({
        types: [
          {
            id: 'TERM_DONE',
            actions: [
              { id: 'done', title: labels.done },
              { id: 'keep', title: labels.keep }
            ]
          }
        ]
      });
    } catch (e) {
      console.warn('[Reminder] registerActionTypes:', e);
    }
    try {
      LN.addListener('localNotificationActionPerformed', (ev) => {
        const noteId = ev && ev.notification && ev.notification.extra && ev.notification.extra.noteId;
        if (onAction) onAction(ev.actionId, noteId);
      });
    } catch {}
    return true;
  }

  // ---- Einkaufs-Orte (Geofencing): Erinnerung bei Ankunft am Laden ----
  function geoAvailable() {
    return !!plugin('NZGeo');
  }
  async function geoRequestPermission() {
    const G = plugin('NZGeo');
    if (!G) return 'unavailable';
    try {
      const r = await G.requestPermission();
      return (r && r.status) || 'prompt';
    } catch {
      return 'denied';
    }
  }
  async function geoAuthStatus() {
    const G = plugin('NZGeo');
    if (!G) return 'unavailable';
    try {
      const r = await G.authStatus();
      return (r && r.status) || 'prompt';
    } catch {
      return 'denied';
    }
  }
  async function geoCurrentPosition() {
    const G = plugin('NZGeo');
    if (!G) return null;
    const r = await G.currentPosition();
    return r && typeof r.lat === 'number' ? { lat: r.lat, lng: r.lng } : null;
  }
  async function geoSetPlaces(places) {
    const G = plugin('NZGeo');
    if (!G) return false;
    try {
      await G.setPlaces({ places: places || [] });
      return true;
    } catch {
      return false;
    }
  }
  async function geoSetSummary(count, body) {
    const G = plugin('NZGeo');
    if (!G) return false;
    try {
      await G.setSummary({ count: count || 0, body: body || '' });
      return true;
    } catch {
      return false;
    }
  }

  // ---- Homescreen-Widget: Termin-Daten in die App Group schieben ----
  async function updateWidget(list) {
    const W = plugin('NZWidget');
    if (!W) return false;
    try {
      await W.update({ json: JSON.stringify(list || []) });
      return true;
    } catch {
      return false;
    }
  }

  // ---- Tastatur (iOS): Editor-Bereich über die Tastatur schrumpfen, statt den ganzen Screen zu schieben ----
  // Setzt --kb-height (Tastaturhöhe) und body.kb-open; das CSS verkleinert dann nur den Editor.
  function initKeyboard() {
    const KB = plugin('Keyboard');
    if (!KB || !KB.addListener) return;
    const doc = global.document;
    if (!doc) return;
    const setKb = (h) => doc.documentElement.style.setProperty('--kb-height', (h || 0) + 'px');
    // iOS soll den WebView NICHT selbst hochscrollen – wir regeln die Höhe per CSS.
    try { KB.setScroll && KB.setScroll({ isDisabled: true }); } catch {}
    KB.addListener('keyboardWillShow', (info) => {
      setKb(info && info.keyboardHeight);
      doc.body.classList.add('kb-open');
    });
    KB.addListener('keyboardWillHide', () => {
      setKb(0);
      doc.body.classList.remove('kb-open');
    });
  }

  global.NZNative = { isNative, onDeepLink, onAppRoute, onAuthCallback, scanAvailable, scanQR, cameraAvailable, takePhoto, openUrl, closeBrowser, nativeRecordAvailable, startNativeRecording, stopNativeRecording, cancelNativeRecording, getRecordingLevel, registerPush, remindersAvailable, requestReminderPermission, replaceReminders, initTermActions, updateWidget, geoAvailable, geoRequestPermission, geoAuthStatus, geoCurrentPosition, geoSetPlaces, geoSetSummary, parseCode, plugin, initKeyboard };
})(typeof window !== 'undefined' ? window : globalThis);
