# OpenOffice Recovery

<!--PAGES_LINK_BANNER-->
> 🌐 **Live page:** [https://socrtwo.github.io/oorecovery-SF/](https://socrtwo.github.io/oorecovery-SF/)  
> 📦 **Releases:** [github.com/socrtwo/oorecovery-SF/releases](https://github.com/socrtwo/oorecovery-SF/releases)
<!--/PAGES_LINK_BANNER-->

Recovers text from corrupt OpenOffice/LibreOffice files (ODT, ODS, ODP) by directly parsing the XML content inside the ODF zip archive.

**Language:** Perl  
**License:** MIT

## Features

- Extracts text from corrupt ODT, ODS, and ODP files
- Parses content.xml directly from the ODF zip archive
- Works when LibreOffice/OpenOffice cannot open the file
- Command-line tool for batch processing

## System Requirements

- Perl 5.10 or later
- Linux, macOS, or Windows (with Strawberry Perl or WSL)

## Installation & Usage

### Running

```bash
# Install Perl (if not already installed)
# Linux/macOS: usually pre-installed
# Windows: download Strawberry Perl from https://strawberryperl.com/

# Run the script
perl <script_name>.pl [arguments]
```

### Dependencies

If the script uses CPAN modules, install them with:
```bash
cpan install Module::Name
```

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