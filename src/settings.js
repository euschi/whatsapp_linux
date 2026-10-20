'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  bounds: { width: 1100, height: 760 },
  maximized: false,
  startMinimized: false,
  closeToTray: true,
  notificationsMuted: false,
  raiseOnIncomingCall: true,
  zoomFactor: 1,
};

const file = () => path.join(app.getPath('userData'), 'settings.json');

let cache = null;
let writeTimer = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(file(), 'utf8')) };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache;
}

function get(key) {
  return load()[key];
}

// Writes are debounced: window move/resize fire many events per second.
function set(key, value) {
  load()[key] = value;
  clearTimeout(writeTimer);
  writeTimer = setTimeout(flush, 500);
}

function flush() {
  clearTimeout(writeTimer);
  if (!cache) return;
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error('Impossibile salvare le impostazioni:', err);
  }
}

module.exports = { get, set, flush };
