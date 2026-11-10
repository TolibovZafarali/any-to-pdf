# Folio Reader for Windows

A small desktop reader for your own PDFs. Import a book, resize the window, and optionally keep it on top of other applications. Your imported books and last page are retained when you close and reopen the app. Reading works offline.

Download the `Folio-Reader-Setup-<version>-x64.exe` installer from the repository's [latest Windows release](https://github.com/TolibovZafarali/any-to-pdf/releases/latest). Double-click it to install for your Windows account; administrator access is not required. Windows 10/11, 64-bit, is supported. The application is unsigned, so Windows may show a publisher or SmartScreen prompt. Release assets include `SHA256SUMS.txt` for checking the download.

## Updating

Version 1.1.0 introduces the installed app and in-app updates. If you already use the portable 1.0.0 executable, close it and run the new installer once. Both versions use the same `%APPDATA%\Folio Reader\` directory, so your imported books, saved pages, and preferences carry over. After verifying the installed app opens your library, you can remove the old portable executable.

For later releases, use the app's update controls to check for a new version, download it, and restart to install it. Update downloads connect to GitHub; your PDFs and reading history are not sent with them. The updater checks the installer's SHA-512 hash against the release metadata. A failed or interrupted update can be retried while the existing app and library remain available.

The release's `latest.yml` and `.blockmap` files support the updater; only the `.exe` needs to be downloaded manually. No app update is necessary to keep reading offline.

## Local data

The app copies imported PDFs into its own library. Moving or deleting the original PDF will not remove the imported copy. Reading positions and window preferences are saved under `%APPDATA%\Folio Reader\` by default. The library is independent of the application's install directory.

Installing an update or uninstalling the app retains this data. Removing the application-data directory clears the library and progress. Back up that directory to retain your books and reading positions.

## Development

Use Node.js 22.13 or newer. From this directory:

```sh
npm ci
npm test
npm run test:app
npm start
```

Build the Windows installer and its update metadata on Windows:

```sh
npm run build
npm run test:installed
node scripts/verify-update.cjs
```

The outputs are `release/Folio-Reader-Setup-<version>-x64.exe`, the corresponding `.exe.blockmap`, and `release/latest.yml`. Verification checks the manifest version, filename, SHA-512, and byte size against the actual installer, then writes SHA-256 checksums for all three files. The web app at the repository root has a separate package and build; desktop commands do not replace it.

## Release

1. Update `desktop/package.json` and its lockfile together to the new version.
2. Commit and push the complete, tested desktop app.
3. Tag that commit `reader-vX.Y.Z`, matching the desktop package version, and push the tag.

The Windows workflow runs the unit and desktop import/restart tests, builds the installer on a Windows runner, tests the installed app and retained library, validates the update manifest, and checks all release artifacts. It uploads the installer, blockmap, update manifest, and checksum file to a draft GitHub Release, then publishes that complete release as latest. This keeps a partially uploaded version out of the updater feed.

The workflow rejects tags that do not match the package version. It can be started manually with an existing matching tag to retry a failed build or finish an unpublished draft; it never replaces an already published release. Keep app releases marked latest because the stable updater reads the latest GitHub Release's `latest.yml`.
