const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const dataFile = path.join(app.getPath('userData'), 'notes.json');
const isWidget = process.argv.includes('--widget');
let mainWin = null;
let widgetWin = null;

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
  } catch {
    return { notes: [], folders: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), 'utf-8');
}

function createWindow() {
  if (mainWin) {
    mainWin.focus();
    return;
  }
  mainWin = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: '#16161e',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWin.on('closed', () => (mainWin = null));
}

function createWidget() {
  if (widgetWin) {
    widgetWin.show();
    widgetWin.focus();
    return;
  }
  widgetWin = new BrowserWindow({
    width: 320,
    height: 440,
    minWidth: 240,
    minHeight: 240,
    frame: false,
    transparent: true,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  widgetWin.loadFile(path.join(__dirname, 'src', 'widget.html'));
  widgetWin.on('closed', () => (widgetWin = null));
}

function setAutostart(enabled) {
  const launchArgs = app.isPackaged ? ['--widget'] : [app.getAppPath(), '--widget'];
  app.setLoginItemSettings({
    openAtLogin: enabled,
    path: process.execPath,
    args: launchArgs
  });
}

ipcMain.handle('notes:load', () => loadData());
ipcMain.handle('notes:save', (_e, data) => {
  saveData(data);
  // keep the other window in sync if both are open
  const sender = BrowserWindow.fromWebContents(_e.sender);
  [mainWin, widgetWin].forEach((w) => {
    if (w && w !== sender) w.webContents.send('notes:changed');
  });
  return true;
});

ipcMain.handle('widget:toggle-pin', () => {
  if (!widgetWin) return true;
  const pinned = !widgetWin.isAlwaysOnTop();
  widgetWin.setAlwaysOnTop(pinned);
  return pinned;
});

ipcMain.handle('widget:is-pinned', () => (widgetWin ? widgetWin.isAlwaysOnTop() : true));
ipcMain.handle('widget:close', () => widgetWin && widgetWin.close());
ipcMain.handle('app:open-full', () => createWindow());
ipcMain.handle('autostart:get', () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle('autostart:set', (_e, enabled) => {
  setAutostart(enabled);
  return enabled;
});

app.whenReady().then(() => {
  // Autostart is enabled by default so the widget returns after a reboot.
  setAutostart(true);

  if (isWidget) {
    createWidget();
  } else {
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      isWidget ? createWidget() : createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
