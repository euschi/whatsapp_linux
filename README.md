# WhatsApp per Linux

Client desktop di WhatsApp per Arch/EndeavourOS basato su Electron (`electron44` di sistema)
che incapsula WhatsApp Web, con comportamento da app nativa.

## Funzionalità

- Notifiche native (libnotify); un click apre la finestra sulla chat
- Icona nella barra di sistema con badge dei non letti e azioni rapide: mostra/nascondi,
  nuova chat, cerca, chat non lette, silenzia notifiche, ricarica, esci
- Chiusura nella barra invece dell'uscita; avvio all'accesso e avvio nascosto (`--hidden`)
- Chiamate e videochiamate (vocali, video, di gruppo) con microfono, webcam e
  condivisione schermo via PipeWire/xdg-desktop-portal (anche su Wayland)
- La finestra si apre da sola su una chiamata in arrivo (si può disattivare)
- Contatore dei non letti nella dock (Dash to Dock / Unity LauncherEntry)
- Correttore ortografico it/en, menu contestuale, zoom (Ctrl +/-/0), dimensioni della finestra ricordate
- Istanza singola: un secondo avvio porta in primo piano la finestra esistente

## Installazione

```sh
cd packaging
makepkg -si
```

Su GNOME, per vedere l'icona nella barra serve l'estensione **AppIndicator**
(`gnome-shell-extension-appindicator`).

## Sviluppo

```sh
npm install
npm start
```

## Flag extra di Chromium

Una per riga in `~/.config/whatsapp-linux-flags.conf`, ad esempio `--ozone-platform=x11`.

## File

- Impostazioni e sessione: `~/.config/whatsapp-linux/`
- Avvio automatico: `~/.config/autostart/whatsapp-linux.desktop`
