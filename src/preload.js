'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__waDesktop', {
  notificationShown: (title, body) => ipcRenderer.send('wa:notification-shown', { title, body }),
  notificationClicked: () => ipcRenderer.send('wa:notification-clicked'),
  isMuted: () => ipcRenderer.sendSync('wa:is-muted'),
});

// Runs in the page's world before WhatsApp's own scripts.
contextBridge.executeInMainWorld({
  func: (chromeMajor) => {
    const bridge = window.__waDesktop;

    // WhatsApp gates features (calls included) on the browser brand, and
    // Electron only advertises "Chromium" in User-Agent Client Hints.
    const brands = [
      { brand: 'Chromium', version: chromeMajor },
      { brand: 'Google Chrome', version: chromeMajor },
      { brand: 'Not.A/Brand', version: '99' },
    ];
    const uaData = navigator.userAgentData;
    if (uaData) {
      const fullVersionList = brands.map((b) => ({ ...b, version: `${b.version}.0.0.0` }));
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        value: {
          brands,
          mobile: false,
          platform: 'Linux',
          toJSON: () => ({ brands, mobile: false, platform: 'Linux' }),
          getHighEntropyValues: async (hints) => ({
            ...(await uaData.getHighEntropyValues(hints)),
            brands,
            fullVersionList,
          }),
        },
      });
    }

    // Wrap notifications so a click can raise the window (the page alone
    // cannot show a window hidden in the tray) and so muting works.
    const NativeNotification = window.Notification;
    class DesktopNotification extends EventTarget {
      constructor(title, options = {}) {
        super();
        this.title = title;
        this.body = options.body || '';
        this.onclick = this.onclose = this.onerror = this.onshow = null;
        if (bridge.isMuted()) return;

        const native = new NativeNotification(title, options);
        this._native = native;
        native.addEventListener('click', (e) => {
          bridge.notificationClicked();
          this.onclick?.(e);
          this.dispatchEvent(new Event('click'));
        });
        for (const type of ['close', 'error', 'show']) {
          native.addEventListener(type, (e) => {
            this[`on${type}`]?.(e);
            this.dispatchEvent(new Event(type));
          });
        }
        bridge.notificationShown(title, this.body);
      }

      close() {
        this._native?.close();
      }

      static get permission() {
        return NativeNotification.permission;
      }

      static requestPermission(cb) {
        return NativeNotification.requestPermission(cb);
      }

      static get maxActions() {
        return NativeNotification.maxActions;
      }
    }
    window.Notification = DesktopNotification;
  },
  args: [process.versions.chrome.split('.')[0]],
});
