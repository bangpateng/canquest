"""
Build CanQuest investor pitch deck (16:9 landscape, dark theme).

Usage (from repo root):
    py -3 scripts/build_pitchdeck_pdf.py

Output: docs/CANQUEST_PITCH_DECK.pdf  (overwrites the old light-theme deck)

Design principles (anti-AI):
- Dark theme, brand-accurate Canton green (#5AD98A, from globals.css).
- Each slide carries ONE visual intent (diagram / flow / grid), not stacked text cards.
- Native ReportLab vector diagrams (Drawing/Rect/Line/Polygon) — crisp, no browser needed.
- No emoji. No fee amounts. 10 slides, no repetition.

Fee policy (matches user docs): revenue SOURCES are named for investors,
but NO CC amounts are shown.
"""

import os

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Frame,
    Image,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# reportlab.graphics — native vector diagrams
from reportlab.graphics.shapes import (
    Drawing,
    Group,
    Line,
    Polygon,
    Rect,
    String,
)
from reportlab.lib.utils import ImageReader

# ─── Paths ───────────────────────────────────────────────────────────────────
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(REPO_ROOT, "docs", "CANQUEST_PITCH_DECK.pdf")
BADGE_PNG = os.path.join(
    REPO_ROOT, "apps", "web", "public", "brand-kit", "canquest-black-bulet.png"
)

# ─── Page: 16:9 landscape ────────────────────────────────────────────────────
PAGE_W, PAGE_H = 1280, 720
PAGESIZE = (PAGE_W, PAGE_H)

# ─── Brand-accurate colors (from app globals.css dark theme) ─────────────────
# NOTE: the previous deck used #00A393 which is NOT the product green.
# Product green = #5AD98A (dark theme primary). Fixing this is core to the
# deck looking on-brand rather than generic.
ACCENT = colors.HexColor("#5AD98A")        # Canton green (primary)
ACCENT_DARK = colors.HexColor("#38B478")   # deeper green (light-theme primary)
CYAN = colors.HexColor("#20D3C3")          # from mark.svg gradient
LIME = colors.HexColor("#8AE878")          # from mark.svg gradient
INK_MUTED = colors.HexColor("#8AE8B4")     # soft green-tint for cover subtext

# Dark theme surface tokens
BG = colors.HexColor("#07080D")            # app background (globals.css)
SURFACE = colors.HexColor("#10131C")       # elevated card bg
SURFACE_2 = colors.HexColor("#161A26")     # nested card
BORDER = colors.HexColor("#1F2632")
TEXT = colors.HexColor("#EDEEF2")          # foreground
TEXT_MUTED = colors.HexColor("#8B92A3")    # muted-foreground (slightly lifted from app for slide legibility)
TEXT_DIM = colors.HexColor("#5C6478")

# ─── Fonts (Windows Times New Roman family) ──────────────────────────────────
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
F = "TNR"

# ─── Geometry ────────────────────────────────────────────────────────────────
MARGIN_X = 80
MARGIN_TOP = 64
MARGIN_BOT = 56
UX0 = MARGIN_X
UY0 = MARGIN_BOT
UX1 = PAGE_W - MARGIN_X
UY1 = PAGE_H - MARGIN_TOP
UW = UX1 - UX0
UH = UY1 - UY0


# ─── Styles ──────────────────────────────────────────────────────────────────
def S(**kw):
    base = dict(fontName=F, fontSize=14, leading=20, textColor=TEXT_MUTED)
    base.update(kw)
    return ParagraphStyle("s", **base)


eyebrow = S(fontSize=11.5, leading=15, textColor=ACCENT)
slide_title = S(fontSize=32, leading=38, textColor=TEXT)
subtitle = S(fontSize=15, leading=22, textColor=TEXT_MUTED)
body = S(fontSize=14, leading=21, textColor=TEXT_MUTED)
body_lg = S(fontSize=17, leading=25, textColor=TEXT)
bullet = S(fontSize=14, leading=22, textColor=TEXT_MUTED, leftIndent=16, bulletIndent=0)
card_title = S(fontSize=14.5, leading=18, textColor=TEXT)
card_body = S(fontSize=12, leading=17, textColor=TEXT_MUTED)
stat_big = S(fontSize=44, leading=48, textColor=ACCENT, alignment=TA_CENTER)
stat_lbl = S(fontSize=12, leading=16, textColor=TEXT_MUTED, alignment=TA_CENTER)
footer_style = S(fontSize=9, leading=12, textColor=TEXT_DIM)

# Cover-specific (on dark bg)
cover_eyebrow = S(fontSize=13, leading=17, textColor=ACCENT)
cover_title = S(fontSize=56, leading=62, textColor=TEXT)
cover_sub = S(fontSize=18, leading=26, textColor=INK_MUTED)
cover_meta = S(fontSize=12.5, leading=18, textColor=ACCENT_DARK)
cta_line = S(fontSize=19, leading=26, textColor=ACCENT)


# ─── Slide chrome ────────────────────────────────────────────────────────────
def _slide_chrome(canvas, slide_no, total, kind="content"):
    """Paint the per-slide background. kind: 'cover' | 'section' | 'content'."""
    c = canvas
    c.saveState()
    # Always dark base
    c.setFillColor(BG)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    if kind == "cover":
        # top + bottom accent hairlines
        c.setFillColor(ACCENT)
        c.rect(0, PAGE_H - 4, PAGE_W, 4, fill=1, stroke=0)
        c.setFillColor(ACCENT)
        c.rect(0, 0, PAGE_W, 4, fill=1, stroke=0)
        # subtle left vertical accent
        c.setFillColor(ACCENT)
        c.rect(0, 0, 4, PAGE_H, fill=1, stroke=0)
    else:
        # thin top rule under header zone
        c.setStrokeColor(BORDER)
        c.setLineWidth(0.6)
        c.line(MARGIN_X, PAGE_H - MARGIN_TOP + 26, PAGE_W - MARGIN_X, PAGE_H - MARGIN_TOP + 26)
        # footer
        c.setFont(F, 9)
        c.setFillColor(TEXT_DIM)
        c.drawString(MARGIN_X, 30, "CanQuest  ·  Canton-native growth platform")
        c.drawRightString(PAGE_W - MARGIN_X, 30, f"{slide_no} / {total}")
    c.restoreState()


# Holder so Frame.addFromList gets a canvas reference during build.
_DUMMY = [None]


def _spacer(h):
    return Spacer(1, h)


def _bullets(items, style=bullet):
    out = []
    for it in items:
        if isinstance(it, tuple):
            label, text = it
            out.append(Paragraph(f"<b>{label}</b> &nbsp;{text}", style, bulletText="•"))
        else:
            out.append(Paragraph(it, style, bulletText="•"))
    return out


def _header(story, eyebrow_text, title_text, desc_text=""):
    story.append(Paragraph(eyebrow_text.upper(), eyebrow))
    story.append(_spacer(6))
    story.append(Paragraph(title_text, slide_title))
    if desc_text:
        story.append(_spacer(8))
        story.append(Paragraph(desc_text, subtitle))


# ─── Card grid helper (dark theme) ───────────────────────────────────────────
def _card_grid(cards, col_count=3, gap=16, card_h=120):
    """cards: list of (title, desc) or (title, desc, iconchar)."""
    while len(cards) % col_count != 0:
        cards.append(None)
    rows = []
    for i in range(0, len(cards), col_count):
        chunk = cards[i:i + col_count]
        row = []
        for c in chunk:
            if c is None:
                row.append("")
                continue
            title, desc = c[0], c[1]
            icon = c[2] if len(c) > 2 else "·"
            cell = [
                Paragraph(
                    f"<font color='#5AD98A'><b>{icon}</b></font> &nbsp;<b>{title}</b>",
                    card_title,
                ),
                Paragraph(desc, card_body),
            ]
            row.append(cell)
        rows.append(row)
    col_w = (UW - gap * (col_count - 1)) / col_count
    t = Table(rows, colWidths=[col_w] * col_count, rowHeights=[card_h] * len(rows))
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
        ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("LINEABOVE", (0, 0), (-1, 0), 1.5, ACCENT),   # top accent edge
        ("INNERGRID", (0, 0), (-1, -1), gap, BG),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    return t


# ═════════════════════════════════════════════════════════════════════════════
# DIAGRAMS — native ReportLab vector drawings
# ═════════════════════════════════════════════════════════════════════════════

def _node(d, x, y, w, h, title, sub="", fill=SURFACE, edge=BORDER, title_color=TEXT):
    """Draw a rounded box node with a title + optional sub-line."""
    d.add(Rect(x, y, w, h, fillColor=fill, strokeColor=edge, strokeWidth=0.8, rx=8, ry=8))
    # title
    d.add(String(x + w / 2, y + h - 26, title,
                 fontName=F, fontSize=12.5, fillColor=title_color, textAnchor="middle"))
    if sub:
        d.add(String(x + w / 2, y + 20, sub,
                     fontName=F, fontSize=9.5, fillColor=TEXT_MUTED, textAnchor="middle"))


def _arrow_h(d, x1, y, x2, color=ACCENT, head=7):
    """Horizontal arrow from (x1,y) to (x2,y)."""
    d.add(Line(x1, y, x2 - head, y, strokeColor=color, strokeWidth=1.6))
    d.add(Polygon([x2, y, x2 - head, y + head / 1.6, x2 - head, y - head / 1.6],
                  fillColor=color, strokeColor=None))


def _arrow_v(d, x, y1, y2, color=ACCENT, head=7):
    """Vertical arrow from (x,y1) down to (x,y2)."""
    d.add(Line(x, y1, x, y2 + head, strokeWidth=1.6, strokeColor=color))
    d.add(Polygon([x, y2, x - head / 1.6, y2 + head, x + head / 1.6, y2 + head],
                  fillColor=color, strokeColor=None))


def diagram_user_journey():
    """Slide 3 — horizontal 5-node user journey with arrows."""
    W, H = UW, 200
    d = Drawing(W, H, hAlign="CENTER")
    n = 5
    node_w = 168
    gap = (W - node_w * n) / (n - 1)
    y = 60
    labels = [
        ("Sign up", "Google"),
        ("Create wallet", "invite + OTP"),
        ("Lock 30 CC", "or earn points"),
        ("Quests &", "campaigns"),
        ("Rewards", "on-chain"),
    ]
    for i, (t1, t2) in enumerate(labels):
        x = i * (node_w + gap)
        # alternate accent tint for visual rhythm
        fill = SURFACE_2 if i % 2 == 0 else SURFACE
        edge = ACCENT if i == n - 1 else BORDER
        tc = ACCENT if i == n - 1 else TEXT
        _node(d, x, y, node_w, 80, t1, t2, fill=fill, edge=edge, title_color=tc)
        if i < n - 1:
            _arrow_h(d, x + node_w, y + 40, x + node_w + gap)
    return d


def diagram_revenue_flow():
    """Slide 8 — revenue flow: user actions → CC fee → splits to Network + CanQuest."""
    W, H = UW, 240
    d = Drawing(W, H, hAlign="CENTER")
    # Left cluster: 4 user actions stacked
    actions = ["Lock CC", "Claim reward", "Send CC", "Swap"]
    ax = 40
    boxw, boxh = 150, 44
    total_h = boxh * len(actions) + 12 * (len(actions) - 1)
    start_y = (H - total_h) / 2
    for i, a in enumerate(actions):
        y = start_y + (len(actions) - 1 - i) * (boxh + 12)
        d.add(Rect(ax, y, boxw, boxh, fillColor=SURFACE, strokeColor=BORDER, strokeWidth=0.8, rx=6, ry=6))
        d.add(String(ax + boxw / 2, y + 16, a, fontName=F, fontSize=12, fillColor=TEXT, textAnchor="middle"))

    # Middle: CC fee funnel node
    mx = ax + boxw + 110
    my = H / 2 - 50
    mw, mh = 150, 100
    d.add(Rect(mx, my, mw, mh, fillColor=SURFACE_2, strokeColor=ACCENT, strokeWidth=1.4, rx=10, ry=10))
    d.add(String(mx + mw / 2, my + mh - 30, "CC settled", fontName=F, fontSize=13, fillColor=ACCENT, textAnchor="middle"))
    d.add(String(mx + mw / 2, my + 24, "on-ledger", fontName=F, fontSize=10, fillColor=TEXT_MUTED, textAnchor="middle"))

    # arrows from each action → funnel
    for i in range(len(actions)):
        y = start_y + (len(actions) - 1 - i) * (boxh + 12) + boxh / 2
        _arrow_h(d, ax + boxw, y, mx)

    # Right: two destination nodes
    rx = mx + mw + 120
    dests = [("Canton Network", "protocol revenue"), ("CanQuest", "platform revenue")]
    dy = H / 2 + 20
    dw, dh = 170, 56
    for i, (t1, t2) in enumerate(dests):
        y = dy - i * (dh + 24) - dh
        edge = ACCENT_DARK if i == 0 else CYAN
        tc = ACCENT_DARK if i == 0 else CYAN
        d.add(Rect(rx, y, dw, dh, fillColor=SURFACE, strokeColor=edge, strokeWidth=1.2, rx=8, ry=8))
        d.add(String(rx + dw / 2, y + dh - 22, t1, fontName=F, fontSize=12.5, fillColor=tc, textAnchor="middle"))
        d.add(String(rx + dw / 2, y + 12, t2, fontName=F, fontSize=9.5, fillColor=TEXT_MUTED, textAnchor="middle"))
        # arrow funnel → dest
        _arrow_h(d, mx + mw, y + dh / 2, rx, color=edge)

    return d


def diagram_antisybil_waterfall():
    """Slide 7 — vertical filter waterfall: 5 layers, each narrows the funnel."""
    W, H = UW, 320
    d = Drawing(W, H, hAlign="CENTER")
    layers = [
        ("Google sign-up", "real identity at entry"),
        ("Email OTP", "verified mailbox"),
        ("One party ID / human", "invite-gated wallet"),
        ("CC commitment", "lock real CC to unlock"),
        ("Server-verified tasks", "audited draws & points"),
    ]
    n = len(layers)
    bar_h = 46
    gap = 10
    total = bar_h * n + gap * (n - 1)
    start_y = H - (H - total) / 2 - bar_h
    max_w = 720
    min_w = 360
    cx = W / 2
    for i, (t1, t2) in enumerate(layers):
        # width narrows progressively (waterfall effect)
        frac = i / (n - 1)
        w = max_w - (max_w - min_w) * frac
        y = start_y - i * (bar_h + gap)
        x = cx - w / 2
        edge = ACCENT if i == n - 1 else BORDER
        tc = ACCENT if i == n - 1 else TEXT
        d.add(Rect(x, y, w, bar_h, fillColor=SURFACE, strokeColor=edge, strokeWidth=0.9, rx=6, ry=6))
        d.add(String(cx, y + bar_h / 2 + 1, t1, fontName=F, fontSize=13, fillColor=tc, textAnchor="middle"))
        d.add(String(cx, y - 13, t2, fontName=F, fontSize=9.5, fillColor=TEXT_MUTED, textAnchor="middle"))
        if i < n - 1:
            # small down-arrow between layers
            _arrow_v(d, cx, y - 2, y - gap + 2, color=ACCENT_DARK, head=6)
    return d


def diagram_architecture():
    """Slide 9 — system architecture: App stack (VPS2) ←WireGuard→ Canton core (VPS1)."""
    W, H = UW, 300
    d = Drawing(W, H, hAlign="CENTER")

    # Left cluster: App stack
    lx, ly = 40, 40
    lw, lh = 300, 230
    d.add(Rect(lx, ly, lw, lh, fillColor=SURFACE, strokeColor=BORDER, strokeWidth=1, rx=12, ry=12))
    d.add(String(lx + lw / 2, ly + lh - 28, "Application stack", fontName=F, fontSize=13, fillColor=ACCENT, textAnchor="middle"))
    d.add(String(lx + lw / 2, ly + lh - 46, "VPS 2  ·  canquest.cc", fontName=F, fontSize=9.5, fillColor=TEXT_DIM, textAnchor="middle"))
    app_items = ["Next.js web  :3000", "NestJS API  :3001", "PostgreSQL (Supabase)", "Redis (queue + cache)"]
    for i, it in enumerate(app_items):
        iy = ly + lh - 90 - i * 36
        d.add(Rect(lx + 24, iy, lw - 48, 28, fillColor=SURFACE_2, strokeColor=BORDER, strokeWidth=0.6, rx=5, ry=5))
        d.add(String(lx + lw / 2, iy + 9, it, fontName=F, fontSize=11, fillColor=TEXT, textAnchor="middle"))

    # Right cluster: Canton core
    rx_, ry = W - 40 - 300, 40
    rw, rh = 300, 230
    d.add(Rect(rx_, ry, rw, rh, fillColor=SURFACE, strokeColor=ACCENT_DARK, strokeWidth=1, rx=12, ry=12))
    d.add(String(rx_ + rw / 2, ry + rh - 28, "Canton core", fontName=F, fontSize=13, fillColor=ACCENT_DARK, textAnchor="middle"))
    d.add(String(rx_ + rw / 2, ry + rh - 46, "Validator VPS", fontName=F, fontSize=9.5, fillColor=TEXT_DIM, textAnchor="middle"))
    core_items = ["Canton participant  :7575", "Splice Validator API", "DAML ledger", "Canton Coin (CC)"]
    for i, it in enumerate(core_items):
        iy = ry + rh - 90 - i * 36
        d.add(Rect(rx_ + 24, iy, rw - 48, 28, fillColor=SURFACE_2, strokeColor=BORDER, strokeWidth=0.6, rx=5, ry=5))
        d.add(String(rx_ + rw / 2, iy + 9, it, fontName=F, fontSize=11, fillColor=TEXT, textAnchor="middle"))

    # Connector: WireGuard tunnel between the two clusters
    mid_y = ly + lh / 2
    line_x1 = lx + lw
    line_x2 = rx_
    # tunnel band
    d.add(Rect(line_x1, mid_y - 16, line_x2 - line_x1, 32, fillColor=SURFACE_2, strokeColor=ACCENT, strokeWidth=0.8, rx=6, ry=6))
    d.add(String((line_x1 + line_x2) / 2, mid_y + 2, "WireGuard tunnel", fontName=F, fontSize=10.5, fillColor=ACCENT, textAnchor="middle"))
    d.add(String((line_x1 + line_x2) / 2, mid_y - 12, "private network", fontName=F, fontSize=8.5, fillColor=TEXT_DIM, textAnchor="middle"))

    return d


# ─── Logo badge as flowable ──────────────────────────────────────────────────
def _badge(size=72):
    """Return an Image flowable for the CanQuest badge, or None if missing."""
    if not os.path.exists(BADGE_PNG):
        return None
    img = Image(BADGE_PNG)
    img.drawWidth = size
    img.drawHeight = size
    return img


# ═════════════════════════════════════════════════════════════════════════════
# STORY
# ═════════════════════════════════════════════════════════════════════════════
def build_story():
    story = []

    # ── SLIDE 1 — COVER ────────────────────────────────────────────────
    badge = _badge(80)
    if badge:
        # center the badge using a 1-col table
        t = Table([[badge]], colWidths=[UW])
        t.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
        story.append(t)
        story.append(_spacer(18))
    story.append(Paragraph("CANQUEST  ·  CANTON NETWORK", cover_eyebrow))
    story.append(_spacer(8))
    story.append(Paragraph("The growth layer for the<br/>Canton ecosystem", cover_title))
    story.append(_spacer(14))
    story.append(Paragraph(
        "A Canton-native quest &amp; wallet platform — verified users,<br/>"
        "real on-chain activity, and recurring network revenue.",
        cover_sub,
    ))
    story.append(_spacer(40))
    story.append(Paragraph("Investor pitch  ·  July 2026  ·  canquest.cc", cover_meta))
    story.append(PageBreak())

    # ── SLIDE 2 — PROBLEM ──────────────────────────────────────────────
    _header(story, "The problem",
            "Canton has the rails. It still lacks real users.",
            "Institutional infrastructure is live — but ecosystem projects can't reach genuine "
            "participants without being drained by bots and farms.")
    story.append(_spacer(20))
    story.append(_card_grid([
        ("Farm-prone quests", "Generic platforms leak rewards to bots, not real users.", "1"),
        ("Weak anti-sybil", "Heuristic checks are gamed; sybils replicate wallets cheaply.", "2"),
        ("No retail surface", "Institutional infra doesn't create everyday CC usage.", "3"),
    ], col_count=3, card_h=140))
    story.append(PageBreak())

    # ── SLIDE 3 — SOLUTION (user journey diagram) ──────────────────────
    _header(story, "How it works",
            "Verification is structural, not heuristic.",
            "One verified human = one Canton wallet. Real on-chain activity is the anti-sybil "
            "signal itself.")
    story.append(_spacer(28))
    story.append(diagram_user_journey())
    story.append(PageBreak())

    # ── SLIDE 4 — PRODUCT (6 menus, one grid) ──────────────────────────
    _header(story, "The product",
            "Six menus, one verified account.",
            "A complete Canton-native dapp in production today.")
    story.append(_spacer(16))
    story.append(_card_grid([
        ("Overview", "Profile, CC holdings, net points, activity.", "01"),
        ("Earn", "Partner campaigns: CC, codes, waitlist.", "02"),
        ("Quests", "Daily & on-chain tasks → points.", "03"),
        ("Wallet", "Send, receive, swap, lock CC.", "04"),
        ("Leaderboard", "Rank by net points.", "05"),
        ("Settings", "Wallet password, one-step transfer, X.", "06"),
    ], col_count=3, card_h=96))
    story.append(PageBreak())

    # ── SLIDE 5 — WALLET & SWAP ────────────────────────────────────────
    _header(story, "Wallet & swap",
            "Where CC moves — for a reason.",
            "A real Canton party ID per user, with full send / receive / swap / lock flows "
            "settling on-ledger.")
    story.append(_spacer(14))
    two_col = Table([[
        [Paragraph("<b>Wallet</b>", card_title),
         _spacer(4),
         *_bullets([
            "Send CC or tokens by @username or party ID.",
            "Receive via QR; accept/reject offers; cancel outgoing.",
            "Lock 30 CC (non-custodial) → Full access.",
            "Full history with Canton explorer links.",
         ])],
        [Paragraph("<b>Swap (Cantex)</b>", card_title),
         _spacer(4),
         *_bullets([
            "Swap CC ↔ USDCX through the Cantex DEX.",
            "Live quote: rate, price impact, network cost.",
            "Auto-refund on timeout; deliveries tracked.",
            "More pairs (CBTC + others) coming soon.",
         ])],
    ]], colWidths=[(UW - 24) / 2, (UW - 24) / 2])
    two_col.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), SURFACE),
        ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
        ("LINEABOVE", (0, 0), (-1, 0), 1.5, ACCENT),
        ("LINEBETWEEN", (0, 0), (-1, -1), 24, BG),
        ("LEFTPADDING", (0, 0), (-1, -1), 18),
        ("RIGHTPADDING", (0, 0), (-1, -1), 18),
        ("TOPPADDING", (0, 0), (-1, -1), 16),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
    ]))
    story.append(two_col)
    story.append(PageBreak())

    # ── SLIDE 6 — CAMPAIGNS (6 reward types) ───────────────────────────
    _header(story, "Partner campaigns",
            "Verified growth for Canton projects.",
            "Projects launch campaigns; CanQuest delivers verified early users. Rewards settle on-chain.")
    story.append(_spacer(16))
    story.append(_card_grid([
        ("CC FCFS", "First-come CC payouts.", "·"),
        ("CC Raffle", "Drawn CC winners.", "·"),
        ("Waitlist FCFS", "First-come invite/access codes.", "·"),
        ("Waitlist Raffle", "Drawn codes.", "·"),
        ("Waitlist Email", "Email raffle entry.", "·"),
        ("CC + Code", "Combined CC & code draw.", "·"),
    ], col_count=3, card_h=80))
    story.append(_spacer(12))
    story.append(Paragraph(
        "Access gates are set per campaign — free, a CC lock, points, or either. "
        "Tasks are social and server-verified; draws use secure randomness.",
        body,
    ))
    story.append(PageBreak())

    # ── SLIDE 7 — ANTI-SYBIL (waterfall diagram) ───────────────────────
    _header(story, "Why it can't be farmed",
            "Each layer narrows the funnel.",
            "Farming becomes economically irrational — faking a participant costs more than the reward.")
    story.append(_spacer(20))
    story.append(diagram_antisybil_waterfall())
    story.append(PageBreak())

    # ── SLIDE 8 — BUSINESS MODEL (revenue flow diagram) ────────────────
    _header(story, "Business model",
            "Usage-based revenue, all on-chain.",
            "Every lock, claim, send, and swap moves CC on-network. Revenue scales with real volume.")
    story.append(_spacer(20))
    story.append(diagram_revenue_flow())
    story.append(_spacer(12))
    story.append(Paragraph(
        "All revenue is denominated in CC, settled on-ledger, and auditable. "
        "Specific amounts are configurable and not published publicly.",
        body,
    ))
    story.append(PageBreak())

    # ── SLIDE 9 — STATUS (architecture diagram + stats) ────────────────
    _header(story, "Status",
            "Mainnet-deployed and internally validated.",
            "Full product flow runs on Canton mainnet with real CC and real party identities.")
    story.append(_spacer(10))
    story.append(diagram_architecture())
    story.append(PageBreak())

    # ── SLIDE 10 — CTA / CONTACT ───────────────────────────────────────
    badge2 = _badge(64)
    if badge2:
        t = Table([[badge2]], colWidths=[UW])
        t.setStyle(TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER")]))
        story.append(t)
        story.append(_spacer(18))
    story.append(Paragraph("Let's build the growth layer for Canton together.", cta_line))
    story.append(_spacer(18))
    center = S(fontSize=14, leading=20, textColor=TEXT_MUTED, alignment=TA_CENTER)
    story.append(Paragraph("CanQuest  ·  canquest.cc", S(fontSize=24, leading=30, textColor=TEXT, alignment=TA_CENTER)))
    story.append(_spacer(8))
    story.append(Paragraph(
        "Partner &amp; investment inquiries: partnership form at canquest.cc/cooperation, "
        "or reply to this conversation.",
        center,
    ))

    return story


# ─── Build ───────────────────────────────────────────────────────────────────
def _make_on_page(total):
    def on_page(canvas, doc):
        page_no = canvas.getPageNumber()
        _DUMMY[0] = canvas
        kind = "cover" if page_no == 1 else "content"
        if page_no == total:
            kind = "cover"  # CTA slide gets the clean dark look too
        _slide_chrome(canvas, page_no, total, kind=kind)
    return on_page


def main():
    if os.path.exists(OUT_PATH):
        os.remove(OUT_PATH)

    # count pages for footer total
    tmp = build_story()
    total = 1 + sum(1 for el in tmp if isinstance(el, PageBreak))

    doc = SimpleDocTemplate(
        OUT_PATH,
        pagesize=PAGESIZE,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOT,
        title="CanQuest — Investor Pitch Deck",
        author="CanQuest",
        creator="CanQuest",
        subject="CanQuest investor pitch — Canton-native growth platform",
    )

    story = build_story()
    doc.build(story, onFirstPage=_make_on_page(total), onLaterPages=_make_on_page(total))

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"✓ Pitch deck generated: {OUT_PATH}  ({size_kb:.0f} KB, {total} slides)")


if __name__ == "__main__":
    main()
