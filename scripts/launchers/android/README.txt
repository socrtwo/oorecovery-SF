OO Recovery — Android
=====================

How to install (recommended — uses the hosted PWA)
--------------------------------------------------
1. Open Chrome on your Android device.
2. Visit:  https://socrtwo.github.io/oorecovery-SF/
3. Tap the menu (⋮) -> "Add to Home screen" / "Install app".
4. Launch from your home screen. Works offline after first run.

Run from this archive (offline)
-------------------------------
The bundled `web/` folder contains the entire app. To run it locally on
Android you need a way to serve files over http(s) — easiest options:

  - Termux:    pkg install python && python -m http.server 8080
               then open http://localhost:8080 in Chrome.
  - KSWEB / Servers Ultimate: point the document root at the `web/` folder.

Direct file://… URLs work for picking files but service-worker offline
caching is disabled on file:// in some Android browsers.

Privacy
-------
Your OpenDocument file never leaves your phone; all processing happens locally.
