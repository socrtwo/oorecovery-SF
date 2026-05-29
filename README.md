<!--MODERNIZED:v1-->
# Oorecovery

> Migrated from SourceForge via SF2GH Migrator

[![Live page](https://img.shields.io/badge/live-page-ff2e93?style=for-the-badge)](https://socrtwo.github.io/oorecovery-SF/)
[![Releases](https://img.shields.io/github/v/release/socrtwo/oorecovery-SF?style=for-the-badge&color=7c3aed)](https://github.com/socrtwo/oorecovery-SF/releases)
[![License](https://img.shields.io/github/license/socrtwo/oorecovery-SF?style=for-the-badge&color=22d3ee)](https://github.com/socrtwo/oorecovery-SF/blob/main/LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/socrtwo/oorecovery-SF?style=for-the-badge&color=34d399)](https://github.com/socrtwo/oorecovery-SF/commits)

🌐 **Live:** https://socrtwo.github.io/oorecovery-SF/  
📦 **Downloads:** [Releases](https://github.com/socrtwo/oorecovery-SF/releases)  
📂 **Source:** [socrtwo/oorecovery-SF](https://github.com/socrtwo/oorecovery-SF)

---

Recover text from — and rebuild — corrupt OpenDocument files (**`.odt`**, **`.ods`**,
**`.odp`**, and OpenOffice.org 1.x **`.sxw`/`.sxc`/`.sxi`**). Originally a Windows/Perl
command-line tool migrated from SourceForge; now a fully offline, cross-platform
**web / PWA** app that runs entirely in your browser. Your file never leaves your device.

**Language:** JavaScript (zero dependencies) · **License:** MIT

## Features

- **Three-stage recovery**, all client-side:
  1. **Standard ZIP read** — opens the archive and validates each entry.
  2. **Low-level byte scan** — when the central directory is destroyed, scans the
     raw bytes for ZIP local-file headers and rebuilds entries one by one.
  3. **XML repair & text rescue** — fixes truncated/malformed XML and extracts
     paragraph and heading text from `content.xml` as a plain-text fallback.
- **Rebuilds a valid ODF package** — the `mimetype` member is written first and
  uncompressed, exactly as the OpenDocument spec requires, so LibreOffice and
  Apache OpenOffice recognise the repaired file.
- **Two outputs:** a repaired `.odt`/`.ods`/`.odp`, and a plain `.txt` dump.
- **100% offline** — installable as a PWA; works with no network after first load.
- **No upload, no server** — recovery happens locally. Decompression uses the
  bundled **Immortal Inflater** (`immortal-inflate.js`), a fault-tolerant pure-JS
  DEFLATE decoder from [Universal-File-Repair-Tool](https://github.com/socrtwo/Universal-File-Repair-Tool)
  that recovers partial data from corrupt/truncated streams instead of failing.

## Install & run

**Easiest — use the hosted app (and install it):**
Open <https://socrtwo.github.io/oorecovery-SF/> and click the browser's install
icon (Chrome/Edge) or *Share → Add to Home Screen* (iOS Safari) to get an
offline desktop/home-screen app.

**Or download a platform bundle from [Releases](https://github.com/socrtwo/oorecovery-SF/releases):**

| Platform | Bundle | How to run |
| --- | --- | --- |
| Windows  | `oorecovery-<ver>-windows.zip`   | Unzip, double-click `OoRecovery.bat` |
| macOS    | `oorecovery-<ver>-macos.zip`     | Unzip, double-click `OoRecovery.command` |
| Linux    | `oorecovery-<ver>-linux.tar.gz`  | Extract, run `./oorecovery.sh` |
| ChromeOS | `oorecovery-<ver>-chromeos.zip`  | Install the PWA, or open `web/index.html` in Chrome |
| Android  | `oorecovery-<ver>-android.zip`   | Install the PWA from Chrome |
| iOS      | `oorecovery-<ver>-ios.zip`       | Add to Home Screen from Safari |
| Web      | `oorecovery-<ver>-web.zip`       | Drop `web/` on any static host |

Each bundle contains the full offline app plus a per-platform launcher and
install instructions (`README.txt`). Verify downloads against `SHA256SUMS`.

## Build releases yourself

```bash
bash scripts/build-releases.sh v1.0.0   # writes bundles to dist/
node scripts/test-recovery.mjs          # run the recovery smoke tests
```

Or trigger the **Build & publish multi-platform releases** GitHub Action and
enter a version tag — it tests, builds all bundles, and attaches them to a
fresh GitHub Release.

## Origin

This project was originally hosted on SourceForge and has been migrated to GitHub for easier access and collaboration.

- **SourceForge:** [oorecovery](https://sourceforge.net/projects/oorecovery/)
- **Migrated with:** [SF2GH Migrator](https://github.com/socrtwo/sf-to-github)

## Contributing

Contributions are welcome! Feel free to:

1. Fork this repository
2. Create a feature branch (`git checkout -b my-feature`)
3. Commit your changes (`git commit -m "Add my feature"`)
4. Push to the branch (`git push origin my-feature`)
5. Open a Pull Request

## License

MIT License — see [LICENSE](LICENSE) for details.

---

## 📜 SourceForge heritage

This project originated on **SourceForge** before being migrated to GitHub. The legacy SourceForge entry, if still available, can be searched at:

🔗 https://sourceforge.net/projects/oorecovery/

The repository here at `socrtwo/oorecovery-SF` is the canonical, actively-maintained home. All future updates, issue tracking, and releases happen on GitHub.

## 🛠️ Contributing

Issues and pull requests are welcome at [https://github.com/socrtwo/oorecovery-SF/issues](https://github.com/socrtwo/oorecovery-SF/issues).

## 📝 License

See the [LICENSE](https://github.com/socrtwo/oorecovery-SF/blob/main/LICENSE) file in this repository. If no license file is present, the project is shared as-is for reference and personal use; please contact the maintainer for other use cases.

---

*Maintained by [@socrtwo](https://github.com/socrtwo)*