This suite drives the PDF to Slides app in headless Chromium and covers single-, multi-page, portrait, landscape, mixed-size, vector/text, raster, unusual-dimension, corrupt, password-protected, Unicode-filename, batch, page-range, quality, cancellation, and UI-responsiveness cases. It also opens each downloaded PPTX with a minimal ZIP reader to verify slide counts, dimensions, titles, and image placement.

Build and run the suite from the repository root with `node build.mjs` followed by `node --test "tests/e2e/*.test.js"`. The quoted glob is required because Node's test runner does not accept the bare directory form.

If a test fails, inspect the rendered UI and the downloaded PPTX and report the application bug; do not edit `src/` or weaken the assertion. The suite does not test Google Slides upload, PowerPoint, LibreOffice, or the File System Access folder picker because headless Chromium cannot drive the native folder dialog.
