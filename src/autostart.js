'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Electron's app.setLoginItemSettings is a no-op on Linux, so we manage the
// XDG autostart entry ourselves.
const FILE = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'autostart',
  'whatsapp-linux.desktop',
);

function launchCommand() {
  // Installed package: use the launcher in PATH. Dev mode: re-run electron on the app dir.
  if (process.env.WA_LAUNCHER) return process.env.WA_LAUNCHER;
  return `"${process.execPath}" "${path.resolve(__dirname, '..')}"`;
}

function isEnabled() {
  return fs.existsSync(FILE);
}

function setEnabled(enabled) {
  if (!enabled) {
    fs.rmSync(FILE, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(
    FILE,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=WhatsApp',
      `Exec=${launchCommand()} --hidden`,
      'Icon=whatsapp-linux',
      'X-GNOME-Autostart-enabled=true',
      'X-GNOME-Autostart-Delay=5',
      '',
    ].join('\n'),
  );
}

module.exports = { isEnabled, setEnabled };
