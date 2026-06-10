/*
 * NZDevice – anonyme Geräte-Identität OHNE Registrierung.
 * Beim ersten Start wird automatisch eine zufällige ID + ein Spitzname + eine Farbe erzeugt
 * und lokal gespeichert. Das ist die Basis für die "Wer war's"-Spur beim Teilen,
 * ganz ohne E-Mail/Passwort. Der Nutzer kann Spitzname/Farbe später ändern.
 */
(function (global) {
  const ID_KEY = 'nz_device_id';
  const PROFILE_KEY = 'nz_profile';

  const COLORS = ['#7c6cff', '#3ad17a', '#ff9f43', '#ff5c72', '#21b8c7', '#e056fd', '#ffd93b', '#4f8cff'];
  const ADJ = ['Flink', 'Ruhig', 'Mutig', 'Klug', 'Froh', 'Wild', 'Sanft', 'Hell'];
  const ANIMAL = ['Fuchs', 'Eule', 'Otter', 'Luchs', 'Dachs', 'Reh', 'Igel', 'Falke'];

  function rndId() {
    return 'dev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function getId() {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = rndId();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  }

  function getProfile() {
    let raw = localStorage.getItem(PROFILE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {}
    }
    const profile = {
      nickname: pick(ADJ) + 'er ' + pick(ANIMAL),
      color: pick(COLORS)
    };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    return profile;
  }

  function setProfile(patch) {
    const p = Object.assign(getProfile(), patch || {});
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
    return p;
  }

  // Kompletter Akteur für die "Wer war's"-Spur.
  function me() {
    const p = getProfile();
    return { id: getId(), nickname: p.nickname, color: p.color };
  }

  global.NZDevice = { getId, getProfile, setProfile, me, COLORS };
})(typeof window !== 'undefined' ? window : globalThis);
