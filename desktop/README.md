# Folio Reader for Windows

A small, offline desktop reader for your own PDFs. Import a book, resize the window, and optionally keep it on top of other applications. Your imported books and last page are retained when you close and reopen the app.

Download the portable `.exe` from the repository's [Windows releases](https://github.com/TolibovZafarali/any-to-pdf/releases). Double-click it to run; no installer, browser, account, or server is needed. Windows 10/11, 64-bit, is supported. The application is unsigned, so Windows may show a publisher or SmartScreen prompt. Release assets include `SHA256SUMS.txt` for checking the download.

## Local data

The app copies imported PDFs into its own library. Moving or deleting the original PDF will not remove the imported copy. Reading positions and window preferences are saved locally. By default, Windows stores this data under `%APPDATA%\Folio Reader\`. The portable executable uses this application-data directory; it does not keep your library beside the `.exe`.

No books, reading history, or settings are uploaded. Removing the application's data directory clears its library and progress. Back up that directory to retain your books and reading positions.

## Development

Use Node.js 22.13 or newer. From this directory:

```sh
npm ci
npm test
npm run test:app
npm start
```

Build the portable Windows executable on Windows:

```sh
npm run build
```

The output is `release/Folio-Reader-<version>-x64.exe`. The web app at the repository root has a separate package and build; desktop commands do not replace it.

## Release

1. Update `desktop/package.json` and its lockfile together to the new version.
2. Commit and push the complete, tested desktop app.
3. Tag that commit `reader-vX.Y.Z`, matching the desktop package version, and push the tag.

The Windows release workflow runs storage and desktop import/restart tests, builds the portable executable on a Windows runner, computes its SHA-256 checksum, and publishes both files in a GitHub Release. It rejects a tag that does not match the package version. The workflow can also be started manually with an existing matching tag when a failed build needs to be retried; it will not overwrite an already published release.
