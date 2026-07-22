"""
Build CanQuest proposal PDF from the markdown source.

Usage (from repo root):
    py -3 scripts/build_proposal_pdf.py

Outputs: docs/CANQUEST PROPOSAL.pdf  (overwrites the stale one)

Design: clean, English-only, investor-facing. Canton brand green (#00A393)
used as accent. No tables, no images, no emoji in this source — pure text,
so this is a Light task (no Playwright/chromium needed). Cover rendered
in-process via ReportLab canvas (simple branded cover, not a gradient).
"""

import os
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

# ─── Paths ───────────────────────────────────────────────────────────────────
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MD_PATH = os.path.join(REPO_ROOT, "docs", "CANQUEST_PROPOSAL.md")
OUT_PATH = os.path.join(REPO_ROOT, "docs", "CANQUEST PROPOSAL.pdf")

# ─── Colors (Canton brand-aligned, manually fixed — this is a branded doc,
#     not a generic report, so the palette generator's auto-hue is overridden
#     with the actual CanQuest brand green) ──────────────────────────────────
ACCENT = colors.HexColor("#00A393")        # CanQuest / Canton brand green
ACCENT_DARK = colors.HexColor("#00766B")   # darker shade for cover
TEXT_PRIMARY = colors.HexColor("#1A1A1A")
TEXT_MUTED = colors.HexColor("#6B7280")
RULE = colors.HexColor("#D1D5DB")
COVER_BG = colors.HexColor("#F7FAFA")      # very light tint of brand green

# ─── Fonts (Windows Times New Roman family) ─────────────────────────────────
FONTS = {
    "TNR": "C:/Windows/Fonts/times.ttf",
    "TNR-Bold": "C:/Windows/Fonts/timesbd.ttf",
    "TNR-Italic": "C:/Windows/Fonts/timesi.ttf",
    "TNR-BoldItalic": "C:/Windows/Fonts/timesbi.ttf",
}
for name, path in FONTS.items():
    pdfmetrics.registerFont(TTFont(name, path))
registerFontFamily(
    "TNR",
    normal="TNR",
    bold="TNR-Bold",
    italic="TNR-Italic",
    boldItalic="TNR-BoldItalic",
)

BODY_FONT = "TNR"

# ─── Page geometry ──────────────────────────────────────────────────────────
LEFT = RIGHT = 25 * mm
TOP = 25 * mm
BOTTOM = 22 * mm
PAGE_W, PAGE_H = A4


# ─── Styles ──────────────────────────────────────────────────────────────────
styles = {
    "h1": ParagraphStyle(
        "H1",
        fontName=BODY_FONT,
        fontSize=16,
        leading=22,
        textColor=ACCENT_DARK,
        spaceBefore=20,
        spaceAfter=10,
    ),
    "h2": ParagraphStyle(
        "H2",
        fontName=BODY_FONT,
        fontSize=12.5,
        leading=17,
        textColor=TEXT_PRIMARY,
        spaceBefore=12,
        spaceAfter=6,
    ),
    "h3": ParagraphStyle(
        "H3",
        fontName=BODY_FONT,
        fontSize=11,
        leading=15,
        textColor=TEXT_PRIMARY,
        spaceBefore=8,
        spaceAfter=4,
    ),
    "body": ParagraphStyle(
        "Body",
        fontName=BODY_FONT,
        fontSize=10.5,
        leading=16,
        textColor=TEXT_PRIMARY,
        alignment=TA_JUSTIFY,
        spaceAfter=7,
    ),
    "bullet": ParagraphStyle(
        "Bullet",
        fontName=BODY_FONT,
        fontSize=10.5,
        leading=15,
        textColor=TEXT_PRIMARY,
        alignment=TA_LEFT,
        leftIndent=16,
        bulletIndent=4,
        spaceAfter=3,
    ),
    "quote": ParagraphStyle(
        "Quote",
        fontName=BODY_FONT,
        fontSize=11,
        leading=16,
        textColor=ACCENT_DARK,
        alignment=TA_LEFT,
        leftIndent=16,
        rightIndent=16,
        spaceBefore=6,
        spaceAfter=8,
        borderColor=ACCENT,
        borderWidth=0,
    ),
    "footer": ParagraphStyle(
        "Footer",
        fontName=BODY_FONT,
        fontSize=8.5,
        leading=11,
        textColor=TEXT_MUTED,
        alignment=TA_CENTER,
    ),
}


# ─── Inline markdown → ReportLab mini-parser ────────────────────────────────
def _esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _inline(text: str) -> str:
    """Convert **bold** and *italic* and `code` to ReportLab tags.

    We escape first, then re-apply tags so entities are safe.
    """
    text = _esc(text)
    # Inline code first (so its content isn't re-processed)
    placeholders = []

    def stash_code(m):
        placeholders.append(
            f'<font name="{BODY_FONT}" color="#b5394b">{m.group(1)}</font>'
        )
        return f"\x00{len(placeholders) - 1}\x00"

    text = re.sub(r"`([^`]+)`", stash_code, text)
    # Bold
    text = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", text)
    # Italic (single * not part of **)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", text)
    # Restore code placeholders
    text = re.sub(
        "\x00(\\d+)\x00", lambda m: placeholders[int(m.group(1))], text
    )
    return text


# ─── Markdown → flowables ───────────────────────────────────────────────────
def md_to_story(md_text: str):
    """Parse the proposal markdown into a list of ReportLab flowables.

    Handles: ## / ### headings, bullets (- ), blockquotes (> ), hr (---),
    paragraphs, and skips the very first H1 + frontmatter (used on the cover).
    """
    story = []
    lines = md_text.splitlines()
    i = 0
    # Skip everything until after the first H1 line (the title) — title goes
    # on the cover, not repeated as body. Also skip the "---" frontmatter
    # dividers and the "Prepared for ... June 2026" subtitle block.
    in_frontmatter = True
    skip_until_h1 = True
    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()

        # Skip leading blank lines while in preamble
        if skip_until_h1:
            if line.startswith("# ") and not line.startswith("## "):
                skip_until_h1 = False  # found the H1, skip it (cover has it)
                i += 1
                # also skip the immediate subtitle/divider lines
                while i < len(lines) and (
                    not lines[i].strip()
                    or lines[i].strip() == "---"
                    or lines[i].strip().startswith("Prepared")
                    or lines[i].strip().startswith("Strategic Proposal")
                ):
                    i += 1
                continue
            i += 1
            continue

        if not line.strip():
            i += 1
            continue

        # Horizontal rule -> small spacer (don't force page breaks)
        if line.strip() in ("---", "***", "___"):
            story.append(Spacer(1, 6))
            i += 1
            continue

        # Headings
        if line.startswith("### "):
            story.append(Paragraph(_inline(line[4:]), styles["h3"]))
            i += 1
            continue
        if line.startswith("## "):
            story.append(Paragraph(_inline(line[3:]), styles["h1"]))
            i += 1
            continue
        if line.startswith("# "):
            # secondary H1 within doc body -> treat as H1
            story.append(Paragraph(_inline(line[2:]), styles["h1"]))
            i += 1
            continue

        # Blockquote (may span multiple consecutive > lines)
        if line.lstrip().startswith(">"):
            quote_lines = []
            while i < len(lines) and lines[i].lstrip().startswith(">"):
                quote_lines.append(
                    re.sub(r"^\s*>\s?", "", lines[i]).rstrip()
                )
                i += 1
            qtext = _inline(" ".join(l.strip() for l in quote_lines if l.strip()))
            story.append(Paragraph(f'<i>{qtext}</i>', styles["quote"]))
            continue

        # Bullet list (group consecutive)
        if re.match(r"^\s*[-*]\s+", line):
            while i < len(lines) and re.match(r"^\s*[-*]\s+", lines[i]):
                item = re.sub(r"^\s*[-*]\s+", "", lines[i]).rstrip()
                # collapse multi-space
                story.append(
                    Paragraph(
                        _inline(item),
                        styles["bullet"],
                        bulletText="•",
                    )
                )
                i += 1
            story.append(Spacer(1, 3))
            continue

        # Paragraph (collect until blank/structural line)
        para = [line]
        i += 1
        while i < len(lines):
            nxt = lines[i].rstrip()
            if (
                not nxt.strip()
                or nxt.strip() in ("---", "***", "___")
                or re.match(r"^#{1,6} ", nxt)
                or nxt.lstrip().startswith(">")
                or re.match(r"^\s*[-*]\s+", nxt)
            ):
                break
            para.append(nxt)
            i += 1
        story.append(Paragraph(_inline(" ".join(para)), styles["body"]))
        continue

    return story


# ─── Cover page (drawn directly on canvas via onFirstPage) ──────────────────
def _draw_header_footer(canvas, doc):
    """Header rule + footer (page number + doc title) on body pages."""
    canvas.saveState()
    # Footer: page number + title
    canvas.setFont(BODY_FONT, 8.5)
    canvas.setFillColor(TEXT_MUTED)
    page_num = canvas.getPageNumber()
    if page_num > 1:
        # thin top rule on body pages
        canvas.setStrokeColor(RULE)
        canvas.setLineWidth(0.4)
        canvas.line(LEFT, BOTTOM - 6, PAGE_W - RIGHT, BOTTOM - 6)
        canvas.drawString(
            LEFT, BOTTOM - 14, "CanQuest — Canton Network Proposal"
        )
        canvas.drawRightString(PAGE_W - RIGHT, BOTTOM - 14, f"{page_num}")
    canvas.restoreState()


def _draw_cover(canvas, doc):
    """Branded cover on page 1 (light tint bg + brand-green accents)."""
    canvas.saveState()
    # Background fill
    canvas.setFillColor(COVER_BG)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # Brand accent band (left edge)
    canvas.setFillColor(ACCENT)
    canvas.rect(0, 0, 8 * mm, PAGE_H, fill=1, stroke=0)
    # Eyebrow
    canvas.setFillColor(ACCENT_DARK)
    canvas.setFont(BODY_FONT, 11)
    canvas.drawString(LEFT, PAGE_H - 70 * mm, "STRATEGIC PROPOSAL")
    # Thin accent rule under eyebrow
    canvas.setStrokeColor(ACCENT)
    canvas.setLineWidth(1.2)
    canvas.line(LEFT, PAGE_H - 73 * mm, LEFT + 40 * mm, PAGE_H - 73 * mm)
    # Title
    canvas.setFillColor(TEXT_PRIMARY)
    canvas.setFont(BODY_FONT + "-Bold", 34)
    canvas.drawString(LEFT, PAGE_H - 95 * mm, "CanQuest")
    canvas.setFont(BODY_FONT, 19)
    canvas.setFillColor(ACCENT_DARK)
    canvas.drawString(LEFT, PAGE_H - 110 * mm, "Canton Network Proposal")
    # Subtitle block
    canvas.setFillColor(TEXT_MUTED)
    canvas.setFont(BODY_FONT + "-Italic", 11)
    canvas.drawString(
        LEFT,
        PAGE_H - 122 * mm,
        "A Canton-native growth platform for verified, active users",
    )
    # Prepared for + date — bottom area
    canvas.setFillColor(TEXT_PRIMARY)
    canvas.setFont(BODY_FONT, 10.5)
    canvas.drawString(LEFT, 48 * mm, "Prepared for")
    canvas.setFont(BODY_FONT + "-Bold", 11)
    canvas.drawString(LEFT, 41 * mm, "Canton Network Ecosystem Review")
    canvas.setFont(BODY_FONT, 10)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(LEFT, 32 * mm, "Prepared June 2026 · Revised July 2026")
    canvas.drawString(LEFT, 26 * mm, "canquest.cc")
    canvas.restoreState()


def _draw_blank(canvas, doc):
    """No-op for body pages so SimpleDocTemplate doesn't overwrite cover."""
    if canvas.getPageNumber() == 1:
        _draw_cover(canvas, doc)
    else:
        _draw_header_footer(canvas, doc)


# ─── Main ───────────────────────────────────────────────────────────────────
def main():
    if not os.path.exists(MD_PATH):
        print(f"ERROR: markdown source not found: {MD_PATH}", file=sys.stderr)
        sys.exit(1)

    with open(MD_PATH, "r", encoding="utf-8") as f:
        md_text = f.read()

    doc = SimpleDocTemplate(
        OUT_PATH,
        pagesize=A4,
        leftMargin=LEFT,
        rightMargin=RIGHT,
        topMargin=TOP,
        bottomMargin=BOTTOM,
        title="CanQuest — Canton Network Proposal",
        author="CanQuest",
        creator="CanQuest",
        subject="Canton-native growth platform — strategic proposal",
    )

    story = md_to_story(md_text)
    # Body starts on page 2; page 1 is the cover (drawn by onFirstPage).
    story.insert(0, PageBreak())

    doc.build(story, onFirstPage=_draw_blank, onLaterPages=_draw_header_footer)

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"✓ PDF generated: {OUT_PATH}  ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
