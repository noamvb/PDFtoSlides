#!/usr/bin/env python3
"""Generate PDF test fixtures for PDFtoSlides test suite."""

import io
import math
from pathlib import Path
import pypdf
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas

REPO_ROOT = Path(__file__).resolve().parent.parent
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures"

A4 = (595.276, 841.89)
LETTER_PORTRAIT = (612, 792)
LETTER_LANDSCAPE = (792, 612)


def make_canvas(filename, pagesize):
    file_path = FIXTURES_DIR / filename
    c = canvas.Canvas(str(file_path), pagesize=pagesize, invariant=True)
    c.setCreator("pdf-to-slides fixtures")
    c.setProducer("pdf-to-slides fixtures")
    return c, file_path


def gen_single_page():
    name = "single-page.pdf"
    c, path = make_canvas(name, A4)
    c.setFont("Helvetica-Bold", 20)
    c.drawString(50, 780, f"{name} - Page 1 of 1")
    c.setFont("Helvetica", 12)
    c.drawString(50, 750, "Standard A4 single-page test fixture.")
    c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_multi_page():
    name = "multi-page.pdf"
    c, path = make_canvas(name, A4)
    for p in range(1, 13):
        c.setFont("Helvetica-Bold", 20)
        c.drawString(50, 780, f"{name} - Page {p} of 12")
        c.setFont("Helvetica", 12)
        c.drawString(50, 750, f"Page number {p} content.")
        c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_portrait():
    name = "portrait.pdf"
    c, path = make_canvas(name, LETTER_PORTRAIT)
    for p in range(1, 4):
        c.setFont("Helvetica-Bold", 20)
        c.drawString(50, 740, f"{name} - Page {p} of 3")
        c.setFont("Helvetica", 12)
        c.drawString(50, 710, "US Letter portrait orientation (612 x 792 pt).")
        c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_landscape():
    name = "landscape.pdf"
    c, path = make_canvas(name, LETTER_LANDSCAPE)
    for p in range(1, 4):
        c.setFont("Helvetica-Bold", 20)
        c.drawString(50, 560, f"{name} - Page {p} of 3")
        c.setFont("Helvetica", 12)
        c.drawString(50, 530, "US Letter landscape orientation (792 x 612 pt).")
        c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_mixed_sizes():
    name = "mixed-sizes.pdf"
    sizes = [
        A4,  # page 1
        A4,  # page 2
        LETTER_LANDSCAPE,  # page 3: 792 x 612
        A4,  # page 4
        (200, 200),  # page 5: 200 x 200
    ]
    file_path = FIXTURES_DIR / name
    c = canvas.Canvas(str(file_path), pagesize=sizes[0], invariant=True)
    c.setCreator("pdf-to-slides fixtures")
    c.setProducer("pdf-to-slides fixtures")
    for p, (w, h) in enumerate(sizes, 1):
        c.setPageSize((w, h))
        if w <= 200:
            c.setFont("Helvetica-Bold", 10)
            c.drawString(15, h - 30, name)
            c.setFont("Helvetica", 8)
            c.drawString(15, h - 50, f"Page {p} of 5 ({w}x{h} pt)")
        else:
            c.setFont("Helvetica-Bold", 18)
            c.drawString(50, h - 60, f"{name} - Page {p} of 5")
            c.setFont("Helvetica", 12)
            c.drawString(50, h - 90, f"Page size: {w} x {h} pt")
        c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_vector_and_text():
    name = "vector-and-text.pdf"
    c, path = make_canvas(name, A4)
    for p_num in (1, 2):
        # Text in at least 3 sizes (24pt, 14pt, 10pt)
        c.setFont("Helvetica-Bold", 24)
        c.drawString(50, 780, f"{name} - Page {p_num} of 2")
        c.setFont("Helvetica-Bold", 14)
        c.drawString(50, 740, "Vector Graphics and Typography Test")
        c.setFont("Helvetica", 10)
        c.drawString(
            50, 715, "Filled bezier curves, stroked polygons in 4 colors, 3 text sizes."
        )

        # Filled bezier curves
        c.setFillColorRGB(0.6, 0.2, 0.7)
        bz1 = c.beginPath()
        bz1.moveTo(100, 560)
        bz1.curveTo(150, 660, 250, 660, 300, 560)
        bz1.curveTo(250, 460, 150, 460, 100, 560)
        bz1.close()
        c.drawPath(bz1, fill=1, stroke=0)

        # Stroked polygons in at least 4 distinct colours
        colors = [
            (0.85, 0.15, 0.15),  # Red: triangle
            (0.15, 0.45, 0.85),  # Blue: diamond
            (0.20, 0.70, 0.25),  # Green: pentagon
            (0.90, 0.60, 0.10),  # Orange: hexagon
        ]
        centers = [(120, 360), (240, 360), (360, 360), (480, 360)]
        sides_list = [3, 4, 5, 6]
        radius = 35
        c.setLineWidth(2.5)
        for col, (cx, cy), sides in zip(colors, centers, sides_list):
            c.setStrokeColorRGB(*col)
            poly = c.beginPath()
            for i in range(sides):
                angle = 2 * math.pi * i / sides - math.pi / 2
                px = cx + radius * math.cos(angle)
                py = cy + radius * math.sin(angle)
                if i == 0:
                    poly.moveTo(px, py)
                else:
                    poly.lineTo(px, py)
            poly.close()
            c.drawPath(poly, fill=0, stroke=1)

        c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_raster_image():
    name = "raster-image.pdf"
    # Build 400x300 RGB gradient PPM (P6)
    img_w, img_h = 400, 300
    header = f"P6\n{img_w} {img_h}\n255\n".encode("ascii")
    data = bytearray(img_w * img_h * 3)
    idx = 0
    for y in range(img_h):
        for x in range(img_w):
            data[idx] = int(255 * x / (img_w - 1))
            data[idx + 1] = int(255 * y / (img_h - 1))
            data[idx + 2] = int(255 * (x + y) / (img_w + img_h - 2))
            idx += 3
    ppm_bytes = header + bytes(data)
    img = ImageReader(io.BytesIO(ppm_bytes))

    c, path = make_canvas(name, A4)
    for p_num in (1, 2):
        c.setFont("Helvetica-Bold", 18)
        c.drawString(45, 805, f"{name} - Page {p_num} of 2")
        c.setFont("Helvetica", 10)
        c.drawString(
            45, 785, "Generated 400x300 RGB raster gradient image filling most of the page"
        )
        c.drawImage(img, 45, 60, width=505.276, height=700)
        c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_tall_narrow():
    name = "tall-narrow.pdf"
    c, path = make_canvas(name, (200, 3000))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(20, 2920, f"{name}")
    c.setFont("Helvetica", 11)
    c.drawString(20, 2890, "Page 1 of 1 (200 x 3000 pt)")
    c.drawString(20, 2000, f"{name} - section at y=2000")
    c.drawString(20, 1500, f"{name} - midpoint at y=1500")
    c.drawString(20, 1000, f"{name} - section at y=1000")
    c.drawString(20, 100, f"{name} - bottom at y=100")
    c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_wide_short():
    name = "wide-short.pdf"
    c, path = make_canvas(name, (3000, 200))
    c.setFont("Helvetica-Bold", 16)
    c.drawString(50, 130, f"{name} - Page 1 of 1 (3000 x 200 pt)")
    c.setFont("Helvetica", 11)
    c.drawString(50, 90, "Wide aspect ratio test fixture")
    c.drawString(1000, 100, f"{name} - intermediate text at x=1000")
    c.drawString(2000, 100, f"{name} - intermediate text at x=2000")
    c.drawString(2700, 100, f"{name} - right section at x=2700")
    c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_tiny_page():
    name = "tiny-page.pdf"
    c, path = make_canvas(name, (36, 36))
    c.rect(1, 1, 34, 34, stroke=1, fill=0)
    c.setFont("Helvetica", 4)
    c.drawString(3, 16, "tiny-page 1")
    c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_huge_page():
    name = "huge-page.pdf"
    c, path = make_canvas(name, (5000, 5000))
    c.setFillColorRGB(0.88, 0.92, 0.96)
    c.rect(500, 500, 4000, 4000, fill=1, stroke=0)
    c.setFillColorRGB(0, 0, 0)
    c.setFont("Helvetica-Bold", 100)
    c.drawString(600, 4200, f"{name} - Page 1 of 1")
    c.setFont("Helvetica", 60)
    c.drawString(600, 4050, "Dimensions: 5000 x 5000 pt (approx 69.4 x 69.4 inches)")
    c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_encrypted():
    name = "encrypted.pdf"
    file_path = FIXTURES_DIR / name

    # Step 1: Generate 2-page PDF in memory with reportlab
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4, invariant=True)
    c.setCreator("pdf-to-slides fixtures")
    c.setProducer("pdf-to-slides fixtures")
    for p in (1, 2):
        c.setFont("Helvetica-Bold", 20)
        c.drawString(50, 780, f"{name} - Page {p} of 2")
        c.setFont("Helvetica", 12)
        c.drawString(50, 740, f"Encrypted PDF test fixture. Page {p} of 2.")
        c.drawString(50, 710, "Passwords: user='hunter2', owner='owner2'")
        c.showPage()
    c.save()

    # Step 2: Encrypt with pypdf
    buf.seek(0)
    reader = pypdf.PdfReader(buf)
    writer = pypdf.PdfWriter()
    for page in reader.pages:
        writer.add_page(page)
    writer.encrypt(user_password="hunter2", owner_password="owner2")
    with open(file_path, "wb") as f:
        writer.write(f)

    # Step 3: Verify with pypdf and print results
    verify_reader = pypdf.PdfReader(str(file_path))
    is_enc = verify_reader.is_encrypted
    status = verify_reader.decrypt("hunter2")
    opened = status in (pypdf.PasswordType.USER_PASSWORD, pypdf.PasswordType.OWNER_PASSWORD)
    print(f"wrote {name} (is_encrypted={is_enc}, opens_with_hunter2={opened})")


def gen_unicode_filename():
    name = "Отчёт 2024 — итоги (v2).pdf"
    c, path = make_canvas(name, A4)
    for p in (1, 2):
        c.setFont("Helvetica-Bold", 18)
        c.drawString(50, 780, f"{name} - Page {p} of 2")
        c.setFont("Helvetica", 12)
        c.drawString(50, 740, f"Non-ASCII Cyrillic filename fixture. Page {p} of 2.")
        c.showPage()
    c.save()
    print(f"wrote {name}")


def gen_corrupt():
    name = "corrupt.pdf"
    file_path = FIXTURES_DIR / name
    corrupt_bytes = b"%PDF-1.4\n" + (b"\xde\xad\xbe\xef" * 100) + b"\n%%EOF\n"
    file_path.write_bytes(corrupt_bytes)
    print(f"wrote {name}")


def main():
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
    gen_single_page()
    gen_multi_page()
    gen_portrait()
    gen_landscape()
    gen_mixed_sizes()
    gen_vector_and_text()
    gen_raster_image()
    gen_tall_narrow()
    gen_wide_short()
    gen_tiny_page()
    gen_huge_page()
    gen_encrypted()
    gen_unicode_filename()
    gen_corrupt()


if __name__ == "__main__":
    main()
