# Bundled libraries

- Mozilla PDF.js / pdfjs-dist 6.3.289, Apache-2.0. https://github.com/mozilla/pdf.js . Includes CMaps, standard fonts and decoder WASM; decoder licenses remain in their directories. QuickJS and PDF scripting sandbox are excluded from registered runtime routes.
- pdf-lib 1.17.1, MIT. https://github.com/Hopding/pdf-lib . Used for server-side PDF page validation. License: vendor/pdf-lib-LICENSE.md.
- sax 1.6.1, BlueOak-1.0.0. https://github.com/isaacs/sax-js . License: vendor/sax-LICENSE.md.
- marked 17.0.5, MIT. https://github.com/markedjs/marked . Tokens render through React elements; raw HTML is never injected. License: vendor/marked-LICENSE.md.

Copied from existing local package installations. No runtime package installation, CDN or external conversion service is required.
