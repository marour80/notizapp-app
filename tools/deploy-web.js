/*
 * Veröffentlicht die aktuelle Web-App (src/) auf GitHub Pages.
 * Ausführen mit:  npm run deploy
 * Ergebnis:       https://marour80.github.io/notizapp/
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'src');
const dep = path.join(root, '.deploy');

if (!fs.existsSync(path.join(dep, '.git'))) {
  console.error('Fehler: .deploy ist nicht eingerichtet. (Erstmaliges Deploy wurde übersprungen?)');
  process.exit(1);
}

function copyDir(s, d) {
  fs.mkdirSync(d, { recursive: true });
  for (const e of fs.readdirSync(s, { withFileTypes: true })) {
    const sp = path.join(s, e.name);
    const dp = path.join(d, e.name);
    if (e.isDirectory()) copyDir(sp, dp);
    else fs.copyFileSync(sp, dp);
  }
}

// .deploy leeren (außer .git), dann src/ frisch hineinkopieren
for (const e of fs.readdirSync(dep)) {
  if (e !== '.git') fs.rmSync(path.join(dep, e), { recursive: true, force: true });
}
copyDir(src, dep);

const run = (c) => execSync(c, { cwd: dep, stdio: 'inherit' });
run('git add -A');
try {
  run('git -c user.email="muhammed.arour2006@gmail.com" -c user.name="marour80" commit -m "Update PWA"');
  run('git push');
  console.log('\n✦ Veröffentlicht: https://marour80.github.io/notizapp/  (1–2 Min bis live)');
} catch {
  console.log('\nKeine Änderungen zum Veröffentlichen.');
}
