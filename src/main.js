'use strict';

const path = require('path');
const {
  app, BrowserWindow, Tray, Menu, Notification, nativeImage, session, shell,
  ipcMain, desktopCapturer, clipboard,
} = require('electron');
const settings = require('./settings');
const autostart = require('./autostart');

const APP_ID = 'whatsapp-linux';
const WA_URL = 'https://web.whatsapp.com/';
const ICONS = path.join(__dirname, '..', 'assets', 'icons');
const CHROME_MAJOR = process.versions.chrome.split('.')[0];
// Reduced UA string, identical to what a stock Chrome on Linux sends.
const USER_AGENT = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
const SEC_CH_UA = `"Chromium";v="${CHROME_MAJOR}", "Google Chrome";v="${CHROME_MAJOR}", "Not.A/Brand";v="99"`;
// Body of WhatsApp's own incoming-call notification (it/en); plain messages must not match.
const CALL_PATTERN = /^(incoming (voice |video )?call|(video)?chiamata( vocale)? in arrivo)/i;

app.setName(APP_ID);
app.setPath('userData', path.join(app.getPath('appData'), APP_ID));
app.setDesktopName(`${APP_ID}.desktop`);
app.userAgentFallback = USER_AGENT;
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer,WaylandWindowDecorations');

let mainWindow = null;
let tray = null;
let unread = 0;
let quitting = false;

const icon = (name) => nativeImage.createFromPath(path.join(ICONS, name));
const isWhatsAppUrl = (url) => {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === 'whatsapp.com' || hostname.endsWith('.whatsapp.com')
      || hostname === 'whatsapp.net' || hostname.endsWith('.whatsapp.net'));
  } catch {
    return false;
  }
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.whenReady().then(init);
}

function init() {
  setupSession();
  setupIpc();
  setupAppMenu();
  createWindow();
  createTray();
}

// ---------------------------------------------------------------- session

function setupSession() {
  const ses = session.defaultSession;
  ses.setUserAgent(USER_AGENT);
  ses.setSpellCheckerLanguages(['it', 'en-US']);

  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*.whatsapp.com/*', 'https://*.whatsapp.net/*'] }, (details, cb) => {
    const headers = details.requestHeaders;
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'sec-ch-ua') headers[key] = SEC_CH_UA;
    }
    cb({ requestHeaders: headers });
  });

  // Calls need camera/microphone/screen; everything else stays denied for
  // non-WhatsApp origins.
  const allowed = (url) => isWhatsAppUrl(url) || url === '' || url.startsWith('about:blank');
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(allowed(details.requestingUrl || wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => allowed(origin || wc?.getURL() || ''));

  // Screen sharing during calls. On Wayland getSources() opens the
  // xdg-desktop-portal picker and returns only what the user selected.
  ses.setDisplayMediaRequestHandler((request, cb) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] })
      .then((sources) => (sources.length ? cb({ video: sources[0] }) : cb({})))
      .catch(() => cb({}));
  }, { useSystemPicker: true });

  ses.on('will-download', (event, item) => {
    item.once('done', (e, state) => {
      if (state !== 'completed') return;
      const n = new Notification({
        title: 'Download completato',
        body: path.basename(item.getSavePath()),
        icon: path.join(ICONS, 'app-128.png'),
      });
      n.on('click', () => shell.showItemInFolder(item.getSavePath()));
      n.show();
    });
  });
}

// ---------------------------------------------------------------- window

function webPreferences() {
  return {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    sandbox: true,
    spellcheck: true,
    // Keeps the socket, ringtones and calls alive while hidden in the tray.
    backgroundThrottling: false,
  };
}

function createWindow() {
  const startHidden = process.argv.includes('--hidden') || settings.get('startMinimized');
  const bounds = settings.get('bounds');

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 400,
    minHeight: 500,
    title: 'WhatsApp',
    icon: path.join(ICONS, 'app-256.png'),
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#111b21',
    webPreferences: webPreferences(),
  });
  if (settings.get('maximized')) mainWindow.maximize();

  const wc = mainWindow.webContents;
  wc.setZoomFactor(settings.get('zoomFactor'));
  wc.loadURL(WA_URL);

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (quitting || !settings.get('closeToTray')) return;
    e.preventDefault();
    mainWindow.hide();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', updateTrayMenu);

  const saveBounds = () => {
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) settings.set('bounds', mainWindow.getBounds());
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);
  mainWindow.on('maximize', () => settings.set('maximized', true));
  mainWindow.on('unmaximize', () => settings.set('maximized', false));

  wc.on('page-title-updated', (e, title) => {
    e.preventDefault();
    const match = /^\((\d+)\)/.exec(title);
    setUnread(match ? Number(match[1]) : 0);
  });

  wc.on('render-process-gone', (e, details) => {
    if (details.reason !== 'clean-exit') setTimeout(() => wc.reload(), 1000);
  });

  attachWebContentsHandlers(wc);
}

// Shared by the main window and by in-app popups (e.g. call windows).
function attachWebContentsHandlers(wc) {
  wc.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url === '' || isWhatsAppUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          icon: path.join(ICONS, 'app-256.png'),
          autoHideMenuBar: true,
          backgroundColor: '#111b21',
          webPreferences: webPreferences(),
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => attachWebContentsHandlers(child.webContents));

  wc.on('will-navigate', (e, url) => {
    if (!isWhatsAppUrl(url)) {
      e.preventDefault();
      openExternal(url);
    }
  });

  wc.on('context-menu', (e, params) => buildContextMenu(wc, params).popup());
}

function openExternal(url) {
  if (/^(https?|mailto|tel):/i.test(url)) shell.openExternal(url);
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow?.isVisible() && mainWindow.isFocused()) mainWindow.hide();
  else showWindow();
}

// Triggers one of WhatsApp Web's own keyboard shortcuts.
function sendShortcut(keyCode, modifiers) {
  showWindow();
  const wc = mainWindow.webContents;
  setTimeout(() => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  }, 150);
}

async function hardReload() {
  await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
  await session.defaultSession.clearCache();
  mainWindow?.webContents.reloadIgnoringCache();
}

function setZoom(delta) {
  const wc = mainWindow?.webContents;
  if (!wc) return;
  const factor = delta === 0 ? 1 : Math.min(2, Math.max(0.5, wc.getZoomFactor() + delta));
  wc.setZoomFactor(factor);
  settings.set('zoomFactor', factor);
}

// ---------------------------------------------------------------- unread / tray

function setUnread(count) {
  if (count === unread) return;
  unread = count;
  app.setBadgeCount(count);
  if (tray) {
    tray.setImage(icon(count > 0 ? 'app-unread-64.png' : 'app-64.png'));
    tray.setToolTip(count > 0 ? `WhatsApp — ${count} non lett${count === 1 ? 'o' : 'i'}` : 'WhatsApp');
  }
  updateTrayMenu();
}

function createTray() {
  tray = new Tray(icon('app-64.png'));
  tray.setToolTip('WhatsApp');
  tray.on('click', toggleWindow);
  updateTrayMenu();
}

function toggleSetting(key) {
  settings.set(key, !settings.get(key));
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const visible = mainWindow?.isVisible();
  const items = [
    { label: visible ? 'Nascondi WhatsApp' : 'Mostra WhatsApp', click: () => (visible ? mainWindow.hide() : showWindow()) },
  ];
  if (unread > 0) {
    items.push({ label: `${unread} chat non lett${unread === 1 ? 'a' : 'e'}`, click: showWindow });
  }
  items.push(
    { type: 'separator' },
    { label: 'Nuova chat', click: () => sendShortcut('N', ['control', 'alt']) },
    { label: 'Cerca', click: () => sendShortcut('/', ['control', 'alt']) },
    { label: 'Chat non lette', click: () => sendShortcut('U', ['control', 'alt', 'shift']) },
    { type: 'separator' },
    { label: 'Silenzia notifiche', type: 'checkbox', checked: settings.get('notificationsMuted'), click: () => toggleSetting('notificationsMuted') },
    { label: 'Mostra finestra per chiamate in arrivo', type: 'checkbox', checked: settings.get('raiseOnIncomingCall'), click: () => toggleSetting('raiseOnIncomingCall') },
    {
      label: 'Impostazioni',
      submenu: [
        { label: 'Avvia all\'accesso', type: 'checkbox', checked: autostart.isEnabled(), click: (item) => { autostart.setEnabled(item.checked); updateTrayMenu(); } },
        { label: 'Avvia nascosto nella barra', type: 'checkbox', checked: settings.get('startMinimized'), click: () => toggleSetting('startMinimized') },
        { label: 'Chiudi nella barra invece di uscire', type: 'checkbox', checked: settings.get('closeToTray'), click: () => toggleSetting('closeToTray') },
      ],
    },
    { type: 'separator' },
    { label: 'Ricarica', click: () => mainWindow?.webContents.reload() },
    { label: 'Ricarica svuotando la cache', click: hardReload },
    { type: 'separator' },
    { label: 'Esci', click: quit },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function quit() {
  quitting = true;
  app.quit();
}

// ---------------------------------------------------------------- menus

function setupAppMenu() {
  // Hidden menu bar (Alt shows it): mostly here for the keyboard accelerators.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'WhatsApp',
      submenu: [
        { label: 'Nascondi finestra', accelerator: 'CmdOrCtrl+W', click: () => mainWindow?.hide() },
        { label: 'Esci', accelerator: 'CmdOrCtrl+Q', click: quit },
      ],
    },
    { role: 'editMenu', label: 'Modifica' },
    {
      label: 'Visualizza',
      submenu: [
        { label: 'Ricarica', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { label: 'Ricarica svuotando la cache', accelerator: 'CmdOrCtrl+Shift+R', click: hardReload },
        { type: 'separator' },
        { label: 'Aumenta zoom', accelerator: 'CmdOrCtrl+=', click: () => setZoom(0.1) },
        { label: 'Aumenta zoom', accelerator: 'CmdOrCtrl+Plus', visible: false, click: () => setZoom(0.1) },
        { label: 'Riduci zoom', accelerator: 'CmdOrCtrl+-', click: () => setZoom(-0.1) },
        { label: 'Zoom predefinito', accelerator: 'CmdOrCtrl+0', click: () => setZoom(0) },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Schermo intero' },
        { role: 'toggleDevTools', label: 'Strumenti per sviluppatori' },
      ],
    },
  ]));
}

function buildContextMenu(wc, params) {
  const items = [];
  if (params.misspelledWord) {
    for (const s of params.dictionarySuggestions.slice(0, 5)) {
      items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    }
    items.push(
      { label: 'Aggiungi al dizionario', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
      { type: 'separator' },
    );
  }
  if (params.linkURL) {
    items.push(
      { label: 'Apri link nel browser', click: () => openExternal(params.linkURL) },
      { label: 'Copia indirizzo link', click: () => clipboard.writeText(params.linkURL) },
      { type: 'separator' },
    );
  }
  if (params.mediaType === 'image' && params.srcURL) {
    items.push(
      { label: 'Copia immagine', click: () => wc.copyImageAt(params.x, params.y) },
      { label: 'Salva immagine con nome…', click: () => wc.downloadURL(params.srcURL) },
      { type: 'separator' },
    );
  }
  const f = params.editFlags;
  if (params.isEditable) {
    items.push(
      { role: 'undo', label: 'Annulla', enabled: f.canUndo },
      { role: 'redo', label: 'Ripeti', enabled: f.canRedo },
      { type: 'separator' },
      { role: 'cut', label: 'Taglia', enabled: f.canCut },
      { role: 'copy', label: 'Copia', enabled: f.canCopy },
      { role: 'paste', label: 'Incolla', enabled: f.canPaste },
      { role: 'selectAll', label: 'Seleziona tutto' },
    );
  } else if (params.selectionText) {
    items.push({ role: 'copy', label: 'Copia' });
  }
  while (items.length && items[items.length - 1].type === 'separator') items.pop();
  if (!items.length) items.push({ role: 'selectAll', label: 'Seleziona tutto' });
  return Menu.buildFromTemplate(items);
}

// ---------------------------------------------------------------- ipc

function setupIpc() {
  ipcMain.on('wa:is-muted', (e) => { e.returnValue = settings.get('notificationsMuted'); });
  ipcMain.on('wa:notification-clicked', showWindow);
  ipcMain.on('wa:notification-shown', (e, { title, body }) => {
    if (settings.get('raiseOnIncomingCall') && CALL_PATTERN.test(body.trim())) showWindow();
  });
}

// ---------------------------------------------------------------- lifecycle

app.on('before-quit', () => {
  quitting = true;
  settings.flush();
});
// The tray keeps the app alive; quitting goes through quit().
app.on('window-all-closed', () => {});
app.on('activate', showWindow);

process.on('uncaughtException', (err) => console.error(err));
