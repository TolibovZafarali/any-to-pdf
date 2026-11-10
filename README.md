# Paperfold

Paperfold turns images into a single PDF in the browser. Choose files, drag them in, or paste a copied image or screenshot. Reorder the previews to set the page order and choose between image-sized, A4, and US Letter pages. Enter a name under **Save PDF as**, or use the first image’s name. Paperfold adds the `.pdf` extension when you download. All processing takes place on the device. Reloading the page clears the queue.

## Download the Windows reader

**[Download Folio Reader for Windows (.exe)](https://github.com/TolibovZafarali/any-to-pdf/releases/download/reader-v1.1.0/Folio-Reader-Setup-1.1.0-x64.exe)** · [Release notes and checksum](https://github.com/TolibovZafarali/any-to-pdf/releases/tag/reader-v1.1.0)

A standalone PDF reading app for **Windows 10/11, 64-bit**. Run the installer once, then open **Folio Reader** from the Start menu. Reading works offline; no account or server is needed.

- Click **Open PDF** to import your books. The app keeps its own local copies.
- Resize the window to fit alongside your work, or use the **pin button** to keep it above other windows.
- Switch between readable **Text** and original **PDF** views, adjust zoom, and jump to a page.
- Reopen the app to return to your last book and page. The bookshelf, window size, and pin preference are remembered.
- When a newer release is available, click **Update and restart** once. The app downloads the update, saves your place, installs it, and reopens. The circular-arrow button checks for updates manually.

**Already using portable version 1.0.0?** Close it and run the new installer once. The installed app uses the same `%APPDATA%\Folio Reader` folder, preserving your books, page positions, window size, and pin setting. Use the installed Start menu app from then on; the old portable executable cannot update itself.

Your PDFs and progress stay on your computer and are never uploaded. Update checks connect to this repository’s GitHub Releases on startup and periodically; downloads happen only when you choose to update. Uninstalling the app leaves your library in place. This build is unsigned, so Windows may display an unknown-publisher or SmartScreen warning.

[Desktop development and release instructions](desktop/README.md)

## Run locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

## Build

```sh
npm run build
npm run preview
```

The `dist/` directory is a standalone static site. It can be served at a domain root or a subpath. Fonts, artwork, the PDF library, and image decoders ship with the build. The clipboard button works on localhost or HTTPS when the browser allows clipboard access. The standard paste shortcut also accepts copied images.

## Test

Install the test browser once, then run the browser regression tests against the production build.

```sh
npx playwright install --only-shell chromium
npm test
```

## Images and compression

JPG, JPEG, PNG, WebP, GIF, BMP, SVG, AVIF, and other browser-decodable images are supported. Bundled decoders add support for common HEIC, HEIF, and TIFF encodings. If an image cannot be opened, Paperfold reports its name and continues with the remaining images. Each input contributes one still image. Transparent areas render on white.

Automatic compression reduces large images when a file reaches 2 MiB or 10 megapixels, or the selection totals 8 MiB. Smaller file reduces resolution and JPEG quality further. High quality keeps more detail. The resulting size depends on the image content.

## Folio reading library — `/books`

`/books` is an independent reading app. Its password is **`kalimdor123`**. This is a client-side convenience gate, not authentication: the password ships in JavaScript and the PDF URLs are publicly accessible. Do not use it to protect confidential books.

The included book is *Animal Farm* by George Orwell (71 PDF pages). PDF.js renders books inside the site, including selectable text, page navigation, and zoom. Current page and reading/finished status are stored in `localStorage` under `folio.reading.v1`; unlocking lasts for the current tab’s session. Clearing browser data removes progress. No accounts, backend, database, or external PDF viewer is used.

The reader uses a full-screen document workspace with neutral toolbars and a page sidebar. Text view presents extracted PDF text in reflowed sans-serif paragraphs by default; PDF view preserves the original page layout. Both share the same page and saved progress. Scanned pages without selectable text can be read in PDF view. Book details are available in the sidebar, and the browser tab is titled “Document workspace” while the reader is open.

To add a book:

1. Put its PDF and cover image in `public/books/`.
2. Add an entry to `src/books/catalog.js` with a unique, stable `id`, `title`, `author`, `year`, `genre`, `file`, `cover`, and `description`. The `file` and `cover` values are filenames relative to `public/books/`.
3. Run `npm run build` and deploy `dist/`. Changing a book’s ID resets its association with saved progress.

`npm run dev` and `npm run build` copy PDF.js fonts, character maps, and WebAssembly resources from the installed package to the ignored `public/pdfjs/` directory. They ship with the site; reading makes no third-party requests. `dist/books/index.html` is the library entry point. Serve `/books` as that directory (or redirect to `/books/`) on your static host; avoid rewriting this route to the converter’s root `index.html`.

Browser tests cover unlocking, PDF rendering, page restoration, finished status, and the original converter. Run `npm test` with the installed Playwright browser. In this cloud environment, the installed system Chromium can be used via:

```sh
NODE_OPTIONS='--import=/workspace/setup/any-to-pdf/system-chromium.mjs' npm test
```
