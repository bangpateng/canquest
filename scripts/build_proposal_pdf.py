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
from reportlab.graphics.shapes import (
    Drawing,
    Line,
    Polygon,
    Rect,
    String,
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
    "caption": ParagraphStyle(
        "Caption",
        fontName=BODY_FONT,
        fontSize=8.5,
        leading=12,
        textColor=TEXT_MUTED,
        alignment=TA_CENTER,
        spaceBefore=4,
        spaceAfter=10,
    ),
}


# ─── Vector workflow diagrams (native reportlab.graphics) ───────────────────
# Available content width for a Drawing placed as a Flowable.
_CONTENT_W = 446  # ~ A4 minus left/right margins (150 - 14*2 ≈ 446pt usable)

_BOX_FILL = colors.HexColor("#F1F7F6")
_BOX_EDGE = colors.HexColor("#5AD98A")
_BOX_TEXT = colors.HexColor("#0F172A")
_BOX_SUB = colors.HexColor("#64748B")


def _box(d, x, y, w, h, title, sub=""):
    """Rounded box node with a title + optional sub-line."""
    d.add(Rect(x, y, w, h, fillColor=_BOX_FILL, strokeColor=_BOX_EDGE,
               strokeWidth=0.9, rx=6, ry=6))
    d.add(String(x + w / 2, y + h - 20, title, fontName="TNR-Bold",
                 fontSize=9.5, fillColor=_BOX_TEXT, textAnchor="middle"))
    if sub:
        d.add(String(x + w / 2, y + 12, sub, fontName="TNR",
                     fontSize=7.5, fillColor=_BOX_SUB, textAnchor="middle"))


def _arrow_h(d, x1, y, x2, color=_BOX_EDGE, head=6):
    d.add(Line(x1, y, x2 - head, y, strokeWidth=1.3, strokeColor=color))
    d.add(Polygon([x2, y, x2 - head, y + head / 1.6, x2 - head, y - head / 1.6],
                  fillColor=color, strokeColor=None))


def _arrow_v(d, x, y1, y2, color=_BOX_EDGE, head=6):
    d.add(Line(x, y1, x, y2 + head, strokeWidth=1.3, strokeColor=color))
    d.add(Polygon([x, y2, x - head / 1.6, y2 + head, x + head / 1.6, y2 + head],
                  fillColor=color, strokeColor=None))


def _curve_loop(d, x1, y1, x2, y2, color=_BOX_EDGE):
    """A dashed return-arrow via two Line segments + arrowhead (simple loop)."""
    d.add(Line(x1, y1, x1, y2, strokeWidth=1.0, strokeColor=color,
               strokeDashArray=[3, 3]))
    d.add(Line(x1, y2, x2, y2, strokeWidth=1.0, strokeColor=color,
               strokeDashArray=[3, 3]))
    d.add(Polygon([x2, y2, x2 - 6, y2 + 4, x2 - 6, y2 - 4],
                  fillColor=color, strokeColor=None))


def fig_enduser_workflow():
    """Figure 1 — end-user workflow with retention loop.

    Horizontal flow: Sign up → Wallet → Lock CC/Points → Quests & campaigns
    → On-chain reward. A dashed return-loop from Reward back to Quests shows
    the retention loop (points feed back into campaign entry).
    """
    W, H = _CONTENT_W, 230
    d = Drawing(W, H, hAlign="CENTER")
    nodes = ["Sign up", "Create wallet", "Lock CC / points", "Quests & campaigns", "Reward on-chain"]
    subs = ["Google", "invite + OTP", "Full access", "verified tasks", "CC + codes"]
    n = len(nodes)
    bw = 76
    gap = (W - bw * n) / (n - 1)
    by = 110
    centers = []
    for i, (t, s) in enumerate(zip(nodes, subs)):
        x = i * (bw + gap)
        _box(d, x, by, bw, 54, t, s)
        centers.append((x + bw / 2, x + bw, x))
        if i < n - 1:
            _arrow_h(d, x + bw, by + 27, x + bw + gap)

    # Retention loop: dashed line from last node top → up → across → down to 4th node
    last_x = centers[-1][0]
    fourth_x = centers[-2][0]
    loop_y = by + 54 + 26
    d.add(Line(last_x, by + 54, last_x, loop_y, strokeWidth=1.0,
               strokeColor=ACCENT_DARK, strokeDashArray=[3, 3]))
    d.add(Line(last_x, loop_y, fourth_x, loop_y, strokeWidth=1.0,
               strokeColor=ACCENT_DARK, strokeDashArray=[3, 3]))
    d.add(Polygon([fourth_x, by + 54, fourth_x - 5, by + 54 + 8, fourth_x + 5, by + 54 + 8],
                  fillColor=ACCENT_DARK, strokeColor=None))
    d.add(String((last_x + fourth_x) / 2, loop_y + 4, "retention loop",
                 fontName="TNR-Italic", fontSize=8, fillColor=ACCENT_DARK,
                 textAnchor="middle"))
    return d


def fig_campaign_revenue():
    """Figure 2 — partner campaign stages with Canton revenue streams.

    Top row: 4 campaign stages left→right (Create → Configure → Launch → Reward).
    Below each stage (except first), a small downward arrow to a "CC revenue" node,
    showing on-chain revenue generated at each step.
    """
    W, H = _CONTENT_W, 250
    d = Drawing(W, H, hAlign="CENTER")
    stages = ["Create campaign", "Configure tasks", "Launch & join", "Reward & claim"]
    n = len(stages)
    sw = 92
    gap = (W - sw * n) / (n - 1)
    sy = 170
    rev_nodes = ["CC entry cost", "CC claim", "CC transfer"]  # revenue at stages 2,3,4
    for i, t in enumerate(stages):
        x = i * (sw + gap)
        # stage box
        d.add(Rect(x, sy, sw, 44, fillColor=_BOX_FILL, strokeColor=_BOX_EDGE,
                   strokeWidth=0.9, rx=6, ry=6))
        d.add(String(x + sw / 2, sy + 16, t, fontName="TNR-Bold",
                     fontSize=9, fillColor=_BOX_TEXT, textAnchor="middle"))
        if i < n - 1:
            _arrow_h(d, x + sw, sy + 22, x + sw + gap)
        # revenue node below (for stages 2,3,4 → indices 1,2,3)
        if i >= 1:
            ry = 70
            rx = x + sw / 2
            d.add(Rect(rx - 38, ry, 76, 34, fillColor=colors.HexColor("#E7F8EE"),
                       strokeColor=ACCENT_DARK, strokeWidth=0.8, rx=5, ry=5))
            d.add(String(rx, ry + 16, rev_nodes[i - 1], fontName="TNR",
                         fontSize=8, fillColor=ACCENT_DARK, textAnchor="middle"))
            d.add(String(rx, ry + 5, "on Canton", fontName="TNR",
                         fontSize=7, fillColor=_BOX_SUB, textAnchor="middle"))
            # down-arrow stage → revenue
            _arrow_v(d, rx, sy - 2, ry + 34, color=ACCENT_DARK, head=5)
    # label row
    d.add(String(W / 2, 30, "Each stage moves CC on-chain — network revenue at every step",
                 fontName="TNR-Italic", fontSize=8.5, fillColor=TEXT_MUTED,
                 textAnchor="middle"))
    return d


# Map marker → (drawing_fn, caption_text)
_FIGURES = {
    "workflow": (fig_enduser_workflow,
                 "Figure 1 — CanQuest end-user workflow, from onboarding to on-chain reward and the retention loop."),
    "campaign": (fig_campaign_revenue,
                 "Figure 2 — Partner campaign workflow and the Canton network revenue streams generated at each stage."),
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

        # Figure marker: <!--FIG:key--> → insert vector diagram + caption
        fig_m = re.match(r"^\s*<!--\s*FIG\s*:\s*([a-zA-Z0-9_-]+)\s*-->\s*$", line)
        if fig_m:
            key = fig_m.group(1).lower()
            if key in _FIGURES:
                draw_fn, caption = _FIGURES[key]
                story.append(Spacer(1, 6))
                story.append(draw_fn())
                story.append(Paragraph(_inline(caption), styles["caption"]))
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
