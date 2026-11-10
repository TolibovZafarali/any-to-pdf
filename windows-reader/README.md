# Windows reader source transfer

**[Download folio-reader-source.zip](https://github.com/TolibovZafarali/any-to-pdf/raw/refs/heads/main/windows-reader/folio-reader-source.zip)** · [SHA-256 checksum](SHA256SUMS.txt)

This folder contains the complete Folio Reader Windows project as a ZIP, ready to move into another repository. The archive extracts to `folio-reader/` and includes:

- Electron application, PDF reader, local library storage, and in-app updater.
- `package.json` and `package-lock.json` for installing exact dependencies.
- All tests and their PDF fixture, with no paths back into this repository.
- Windows validation and release workflows under `.github/workflows/`.
- `README.md` and `CODEX_HANDOFF.md` with setup and migration instructions.

Generated builds, installers, dependencies, credentials, and user libraries are excluded.

## Move it to another repository

1. Download the ZIP and put it in the new repository.
2. Ask Codex to unpack it and follow `folio-reader/CODEX_HANDOFF.md`.
3. Configure that repository as the Windows release and update destination, then validate the app before publishing a new version.

Suggested prompt:

> Extract folio-reader-source.zip and read folio-reader/CODEX_HANDOFF.md. Organize the project at this repository's root, including its .github workflows. Configure this repository as its GitHub release and update destination, preserve the app identity and local library compatibility, install dependencies, and run the tests. Prepare the Windows build without publishing a release.

Existing installed versions still check the original repository for updates. The handoff explains how to move users to the new update feed while keeping their saved books and pages. Existing published releases remain available in the original repository.
