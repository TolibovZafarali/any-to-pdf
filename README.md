# Paperfold

Paperfold turns images into a single PDF in the browser. Choose files, drag them in, or paste a copied image or screenshot. Drag a photo preview or its grip to change the PDF page order; on touchscreens, hold briefly before dragging. For keyboard control, focus a grip and use the arrow keys, Home, or End. Choose between image-sized, A4, and US Letter pages. Enter a name under **Save PDF as**, or use the first image’s name. Paperfold adds the `.pdf` extension when you download. All processing takes place on the device. Reloading the page clears the queue.

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
