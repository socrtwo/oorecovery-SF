OO Recovery — iOS / iPadOS
==========================

How to install (recommended)
----------------------------
OO Recovery installs from Safari as a Progressive Web App.

1. Open Safari on your iPhone/iPad.
2. Visit:  https://socrtwo.github.io/oorecovery-SF/
3. Tap the Share icon -> "Add to Home Screen".
4. Launch from your home screen. Requires iOS 16.4+ for full offline support.

Run from this archive
---------------------
The bundled `web/` folder contains the entire app. Because iOS Safari does
not run pages from local file:// URLs, you can:

  - Upload `web/` to any static-hosting service (GitHub Pages, Netlify, S3,
    CloudFront, your own server) and visit it from Safari.
  - Or use an iOS web-server app such as "Web Server for iOS" or "Working
    Copy" to serve the folder over http://localhost.

Privacy
-------
Your OpenDocument file never leaves your device; all processing happens
locally in Safari.
