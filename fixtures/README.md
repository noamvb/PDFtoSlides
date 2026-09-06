# Test Fixtures

Test fixtures for the `PDFtoSlides` test suite.

All fixtures are located under `tests/fixtures/` and generated deterministically by `fixtures/generate.py` (with the exception of pre-existing `smoke-a4.pdf`).

## Fixture Index

| Filename | Pages | Dimensions (pt) | Purpose / What It Tests |
|---|---|---|---|
| `smoke-a4.pdf` | 1 | 595.276 x 841.89 | Baseline smoke test fixture (pre-existing) |
| `single-page.pdf` | 1 | 595.276 x 841.89 | Single-page A4 document handling |
| `multi-page.pdf` | 12 | 595.276 x 841.89 | Pagination, multi-page slide conversion (12 pages) |
| `portrait.pdf` | 3 | 612 x 792 | Standard US Letter portrait orientation |
| `landscape.pdf` | 3 | 792 x 612 | Standard US Letter landscape orientation |
| `mixed-sizes.pdf` | 5 | Varied (A4, Letter Landscape, 200x200) | Per-page dimension handling across varied page sizes |
| `vector-and-text.pdf` | 2 | 595.276 x 841.89 | Filled bezier curves, stroked polygons (4 colors), 3 font sizes |
| `raster-image.pdf` | 2 | 595.276 x 841.89 | RGB raster image rendering (400x300 PPM gradient filling page) |
| `tall-narrow.pdf` | 1 | 200 x 3000 | Extreme aspect ratio: tall and narrow strip |
| `wide-short.pdf` | 1 | 3000 x 200 | Extreme aspect ratio: wide and short banner |
| `tiny-page.pdf` | 1 | 36 x 36 | Extremely small page size (0.5 x 0.5 in) with scaled text |
| `huge-page.pdf` | 1 | 5000 x 5000 | Extremely large page size (approx. 69.4 x 69.4 in) with large rectangle and text |
| `encrypted.pdf` | 2 | 595.276 x 841.89 | Encrypted PDF (user password `hunter2`, owner password `owner2`) |
| `Отчёт 2024 — итоги (v2).pdf` | 2 | 595.276 x 841.89 | Unicode / non-ASCII UTF-8 filename handling (Cyrillic, spaces, em dash, parentheses) |
| `corrupt.pdf` | — | — | Error handling for corrupt/unreadable PDF files |

## Regeneration

Regenerate all generated fixtures using:

```bash
uv run --quiet --with pypdf --with reportlab python3 fixtures/generate.py
```
