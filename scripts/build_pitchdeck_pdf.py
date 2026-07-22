"""
Build CanQuest investor pitch deck (16:9 landscape PDF).

Usage (from repo root):
    py -3 scripts/build_pitchdeck_pdf.py

Output: docs/CANQUEST_PITCH_DECK.pdf

Design:
- Landscape 16:9 (1280x720 pt). One slide per page.
- Canton brand green (#00A393) accent, dark text on near-white.
- English, investor-facing. No emoji (ReportLab limitation).
- Slide taxonomy: title, section, bullets, stat, two-col, closing.
- Consistent with the public docs (no fee amounts in the deck).

Fee policy: business model and revenue SOURCES are described (investors must
know where money comes from), but NO specific fee numbers/amounts are shown —
mirroring the user docs. Claim/transfer/holding/swap fees are referenced by
NAME only, not by CC amount.
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
    KeepInFrame,
    PageBreak,
    Paragraph,
    Table,
    TableStyle,
)

# ─── Paths ───────────────────────────────────────────────────────────────────
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(REPO_ROOT, "docs", "CANQUEST_PITCH_DECK.pdf")

# ─── Page: 16:9 landscape, 1280x720 pt ───────────────────────────────────────
PAGE_W, PAGE_H = 1280, 720
PAGESIZE = (PAGE_W, PAGE_H)

# ─── Colors ──────────────────────────────────────────────────────────────────
ACCENT = colors.HexColor("#00A393")       # Canton / CanQuest brand green
ACCENT_DARK = colors.HexColor("#00766B")
INK = colors.HexColor("#0F172A")          # near-black headings
BODY = colors.HexColor("#334155")         # slate body text
MUTED = colors.HexColor("#64748B")
RULE = colors.HexColor("#E2E8F0")
TINT = colors.HexColor("#F1F7F6")         # very light brand tint
WHITE = colors.white
COVER_BG = colors.HexColor("#06231F")     # deep green-black for cover
CARD_BG = colors.HexColor("#F8FAFC")

# ─── Fonts (Windows TNR family) ──────────────────────────────────────────────
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
MARGIN_TOP = 70
MARGIN_BOT = 60

# Usable area
UX0 = MARGIN_X
UY0 = MARGIN_BOT
UX1 = PAGE_W - MARGIN_X
UY1 = PAGE_H - MARGIN_TOP
UW = UX1 - UX0
UH = UY1 - UY0


# ─── Styles ──────────────────────────────────────────────────────────────────
def S(**kw):
    base = dict(fontName=F, fontSize=14, leading=20, textColor=BODY)
    base.update(kw)
    return ParagraphStyle("s", **base)


eyebrow = S(fontSize=12, textColor=ACCENT_DARK, leading=16)
slide_title = S(fontSize=30, leading=36, textColor=INK)
slide_title_lg = S(fontSize=38, leading=44, textColor=INK)
subtitle = S(fontSize=16, leading=24, textColor=MUTED)
body = S(fontSize=15, leading=23, textColor=BODY)
body_sm = S(fontSize=13, leading=19, textColor=BODY)
bullet = S(fontSize=15, leading=22, textColor=BODY, leftIndent=18, bulletIndent=2)
card_title = S(fontSize=16, leading=21, textColor=INK)
card_body = S(fontSize=12.5, leading=18, textColor=BODY)
stat_big = S(fontSize=46, leading=50, textColor=ACCENT_DARK, alignment=TA_CENTER)
stat_lbl = S(fontSize=13, leading=17, textColor=MUTED, alignment=TA_CENTER)
footer = S(fontSize=9.5, leading=12, textColor=MUTED)
cover_eyebrow = S(fontSize=14, leading=18, textColor=ACCENT)
cover_title = S(fontSize=58, leading=64, textColor=WHITE)
cover_sub = S(fontSize=20, leading=28, textColor=colors.HexColor("#A7F3D0"))
cover_meta = S(fontSize=13, leading=18, textColor=colors.HexColor("#5EEAD4"))


# ─── Slide rendering helpers ─────────────────────────────────────────────────
def _slide_chrome(canvas, slide_no, total, is_cover=False):
    """Draw accent band, footer, page number. Called for every page."""
    canvas.saveState()
    if is_cover:
        canvas.setFillColor(COVER_BG)
        canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        # accent rule top
        canvas.setFillColor(ACCENT)
        canvas.rect(0, PAGE_H - 6, PAGE_W, 6, fill=1, stroke=0)
        # thin vertical accent on left
        canvas.setFillColor(ACCENT)
        canvas.rect(0, 0, 6, PAGE_H, fill=1, stroke=0)
        canvas.restoreState()
        return

    # White bg body slides
    canvas.setFillColor(WHITE)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # left accent strip
    canvas.setFillColor(ACCENT)
    canvas.rect(0, 0, 6, PAGE_H, fill=1, stroke=0)
    # top hairline rule
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN_X, PAGE_H - MARGIN_TOP + 28, PAGE_W - MARGIN_X, PAGE_H - MARGIN_TOP + 28)
    # footer text + page no
    canvas.setFont(F, 9.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN_X, 30, "CanQuest  ·  Canton-native growth platform")
    canvas.drawRightString(PAGE_W - MARGIN_X, 30, f"{slide_no} / {total}")
    canvas.restoreState()


def _frame(story_items):
    """Place story items in the usable frame region (centered content)."""
    f = Frame(UX0, UY0, UW, UH, leftPadding=0, rightPadding=0,
              topPadding=0, bottomPadding=0, showBoundary=0)
    f.addFromList(list(story_items), _DUMMY_CANVAS_HOLD[0])


# We need a canvas reference for Frame.addFromList; SimpleDocTemplate provides it
# via the build callback. Use a holder to pass the canvas in.
_DUMMY_CANVAS_HOLD = [None]


def _bullets(items):
    """Build a list of Paragraph bullets."""
    out = []
    for it in items:
        # it may be (label, text) or plain text
        if isinstance(it, tuple):
            label, text = it
            out.append(
                Paragraph(f"<b>{label}</b> &nbsp;{text}", bullet, bulletText="•")
            )
        else:
            out.append(Paragraph(it, bullet, bulletText="•"))
    return out


def _cards_row(cards, col_count=3, gap=18, card_h=150):
    """Render N cards in a row as a Table grid."""
    # pad to fill rows evenly
    while len(cards) % col_count != 0:
        cards.append(("", "", ""))
    rows = []
    cell_style = S(fontSize=12.5, leading=18, textColor=BODY)
    title_style = S(fontSize=14, leading=18, textColor=INK)
    for i in range(0, len(cards), col_count):
        chunk = cards[i:i + col_count]
        row = []
        for c in chunk:
            if c == ("", "", ""):
                row.append("")
                continue
            title, desc = c[0], c[1]
            icon = c[2] if len(c) > 2 else "·"
            cell = [
                Paragraph(f"<font color='#00A393'><b>{icon}</b></font> &nbsp;<b>{title}</b>", title_style),
                Paragraph(desc, cell_style),
            ]
            row.append(cell)
        rows.append(row)
    col_w = (UW - gap * (col_count - 1)) / col_count
    t = Table(rows, colWidths=[col_w] * col_count, rowHeights=[card_h] * len(rows))
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("INNERGRID", (0, 0), (-1, -1), gap, WHITE),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))
    return t


def _stat_grid(stats, col_count=4, gap=16, card_h=130):
    """Render a row of big-number stat cards."""
    rows = []
    cell_style = S(fontSize=12.5, leading=17, textColor=MUTED, alignment=TA_CENTER)
    big_style = S(fontSize=40, leading=44, textColor=ACCENT_DARK, alignment=TA_CENTER)
    for i in range(0, len(stats), col_count):
        chunk = stats[i:i + col_count]
        row = []
        for s in chunk:
            row.append([
                Paragraph(s[0], big_style),
                Paragraph(s[1], cell_style),
            ])
        rows.append(row)
    col_w = (UW - gap * (col_count - 1)) / col_count
    t = Table(rows, colWidths=[col_w] * col_count, rowHeights=[card_h] * len(rows))
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BACKGROUND", (0, 0), (-1, -1), TINT),
        ("BOX", (0, 0), (-1, -1), 0.6, ACCENT),
        ("INNERGRID", (0, 0), (-1, -1), gap, WHITE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))
    return t


# ─── The deck ────────────────────────────────────────────────────────────────
# Each entry: ("chrome_type", content_callable)
# chrome_type: "cover" | "section" | "content"
# content_callable(story) appends flowables for that slide.


def build_story():
    story = []

    # ── SLIDE 1 — COVER ─────────────────────────────────────────────────
    story.append(Paragraph("CANQUEST  ·  CANTON NETWORK", cover_eyebrow))
    story.append(_spacer(10))
    story.append(Paragraph("The growth layer for the<br/>Canton ecosystem", cover_title))
    story.append(_spacer(14))
    story.append(Paragraph(
        "A Canton-native quest &amp; wallet platform — verified users, real on-chain activity,<br/>"
        "and recurring network revenue.",
        cover_sub,
    ))
    story.append(_spacer(40))
    story.append(Paragraph(
        "Investor pitch  ·  July 2026  ·  canquest.cc",
        cover_meta,
    ))
    story.append(PageBreak())

    # ── SLIDE 2 — PROBLEM ───────────────────────────────────────────────
    _header(story, "The problem", "Canton has the rails. It still lacks real users.",
            "Institutional infrastructure exists, but ecosystem projects still can't reach genuine "
            "participants without being drained by bots and farms.")
    story.append(_spacer(16))
    story.extend(_bullets([
        ("Generic quest platforms are farm-prone — rewards leak to bots, not real users.",
         ""),
        ("Heuristic anti-bot checks are weak — sybils replicate wallets cheaply.",
         ""),
        ("Institutional Canton infra doesn't create everyday CC usage or retail participation.",
         ""),
        ("Projects launching on Canton need a practical, verified growth channel.",
         ""),
    ]))
    story.append(PageBreak())

    # ── SLIDE 3 — SOLUTION ──────────────────────────────────────────────
    _header(story, "The solution", "CanQuest: structural verification, not heuristics.",
            "One verified human = one Canton wallet. Real activity — locking CC, transacting, "
            "swapping — is the Sybil signal itself.")
    story.append(_spacer(18))
    story.append(_cards_row([
        ("Verified identity", "Google sign-up, one wallet per human via invite-gated party ID, email OTP.", "1"),
        ("On-chain commitment", "Lock CC non-custodially to reach Full access and unlock partner campaigns.", "2"),
        ("Real activity loop", "Quests, on-chain sends/swaps, and campaigns that move CC for a real reason.", "3"),
    ], col_count=3, card_h=170))
    story.append(PageBreak())

    # ── SLIDE 4 — PRODUCT (6 menus) ─────────────────────────────────────
    _header(story, "What the product does", "Six menus, one verified account.",
            "A complete Canton-native dapp — wallet, quests, partner campaigns, leaderboard, and swap — "
            "all in production today.")
    story.append(_spacer(16))
    story.append(_cards_row([
        ("Overview", "Dashboard: profile, CC holdings, net points, activity stats.", "·"),
        ("Earn", "Partner campaigns with CC, invite codes, waitlist slots.", "·"),
        ("Quests", "Daily & on-chain tasks (send, swap, lock) that earn points.", "·"),
        ("Wallet", "Canton party ID: send, receive, swap, lock, offers.", "·"),
        ("Leaderboard", "Weekly / monthly / all-time ranking by net points.", "·"),
        ("Settings", "Wallet password, one-step transfer, X connection.", "·"),
    ], col_count=3, card_h=120))
    story.append(PageBreak())

    # ── SLIDE 5 — WALLET & SWAP ─────────────────────────────────────────
    _header(story, "Canton-native wallet", "Where CC moves — for a reason.",
            "A real Canton party ID per user, with full send / receive / swap / lock flows settling on-ledger.")
    story.append(_spacer(16))
    two_col = Table([[
        [Paragraph("<b>Wallet capabilities</b>", card_title),
         _spacer(6),
         *_bullets([
            "Send CC or tokens by @username or Canton party ID.",
            "Receive via QR code; accept/reject incoming offers; cancel outgoing.",
            "Lock 30 CC (non-custodial) to reach Full access.",
            "Full transaction history with Canton explorer links.",
         ])],
        [Paragraph("<b>Swap (Cantex)</b>", card_title),
         _spacer(6),
         *_bullets([
            "Swap CC ↔ USDCX through the Cantex DEX, on-network.",
            "Live quote: rate, price impact, applicable network cost.",
            "Auto-refund on timeout; failed deliveries tracked.",
            "More pairs (CBTC and others) coming soon.",
         ])],
    ]], colWidths=[(UW - 24) / 2, (UW - 24) / 2])
    two_col.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("LINEBETWEEN", (0, 0), (-1, -1), 24, WHITE),
        ("LEFTPADDING", (0, 0), (-1, -1), 20),
        ("RIGHTPADDING", (0, 0), (-1, -1), 20),
        ("TOPPADDING", (0, 0), (-1, -1), 18),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
    ]))
    story.append(two_col)
    story.append(PageBreak())

    # ── SLIDE 6 — CAMPAIGNS / EARN ──────────────────────────────────────
    _header(story, "Partner campaigns", "Verified growth for Canton projects.",
            "Projects launch campaigns; CanQuest delivers verified, active early users — and rewards settle on-chain.")
    story.append(_spacer(16))
    story.append(_cards_row([
        ("CC rewards", "First-come or raffle-drawn CC payouts, settled to the user's wallet.", "·"),
        ("Invite / access codes", "Early entry to partner apps, testnets, or whitelists.", "·"),
        ("Waitlist spots", "Raffle or FCFS slots for launches and drops.", "·"),
        ("CC + code combos", "Combined CC and code rewards in a single draw.", "·"),
    ], col_count=4, card_h=140))
    story.append(_spacer(12))
    story.append(Paragraph(
        "Each campaign sets its own access gate — free, a CC lock, points, or either. "
        "Tasks are social (follow, join) and server-verified; draws use secure randomness.",
        body_sm,
    ))
    story.append(PageBreak())

    # ── SLIDE 7 — ANTI-SYBIL ────────────────────────────────────────────
    _header(story, "Why it can't be farmed", "Verification is structural, not heuristic.",
            "Farming becomes economically irrational — the cost of faking a participant exceeds the reward.")
    story.append(_spacer(18))
    story.extend(_bullets([
        ("One party ID per human", "— invite-gated wallet creation under a daily quota."),
        ("Google sign-up + email OTP", "— real identity signals at account creation."),
        ("CC commitment", "— Full access requires locking real CC, returned in full."),
        ("Server-verified tasks", "— points and draws decided on the server with audit trails."),
        ("Referral anti-farm", "— rewards require verified email + connected X; self-referrals and alias farming blocked."),
    ]))
    story.append(PageBreak())

    # ── SLIDE 8 — BUSINESS MODEL (no fee amounts) ───────────────────────
    _header(story, "Business model", "Usage-based revenue, all on-chain.",
            "Revenue scales with real transaction volume — every lock, claim, send, and swap moves CC on-network.")
    story.append(_spacer(16))
    story.append(_cards_row([
        ("Campaign claim fees",
         "Reward claims carry a CC cost settled on-chain — tied to genuine campaign activity.", "1"),
        ("Transfer fees",
         "A platform cost on CC and token sends — recurring revenue from everyday wallet use.", "2"),
        ("Swap fees",
         "A network cost (to the Cantex trading account) plus an optional platform cost per swap.", "3"),
        ("Holding fee",
         "A network cost while CC is locked — recurring revenue throughout the lock term.", "4"),
    ], col_count=2, card_h=110))
    story.append(_spacer(10))
    story.append(Paragraph(
        "All revenue is denominated in CC, settled on-ledger, and auditable. Specific amounts are "
        "configurable and not published publicly.",
        body_sm,
    ))
    story.append(PageBreak())

    # ── SLIDE 9 — TRACTION / STATUS ─────────────────────────────────────
    _header(story, "Status", "Mainnet-deployed and internally validated.",
            "The full product flow runs on Canton mainnet with real CC and real party identities.")
    story.append(_spacer(18))
    story.append(_stat_grid([
        ("6", "dapp menus, all live"),
        ("4", "reward claim types implemented"),
        ("1", "DEX swap pair live (CC↔USDCX)"),
        ("6", "anti-sybil layers enforced"),
    ], col_count=4, card_h=130))
    story.append(_spacer(16))
    story.extend(_bullets([
        "Mainnet deployment (not a testnet) — wallet, quests, campaigns, swap, leaderboard.",
        "Full flow exercised by the core team with real CC and real Canton party identities.",
        "On-chain audit trails and CantonScan explorer links on every transaction.",
        "Now preparing the first public user cohort and initial partner campaigns.",
    ]))
    story.append(PageBreak())

    # ── SLIDE 10 — GO-TO-MARKET ─────────────────────────────────────────
    _header(story, "Go-to-market", "Indonesia &amp; Southeast Asia first.",
            "A Canton-native growth platform can become the practical entry point for a high crypto-participation region.")
    story.append(_spacer(16))
    story.append(_cards_row([
        ("Phase 1 — Activate",
         "Onboard first CC holders; run initial partner campaigns; validate unit economics on mainnet.", "1"),
        ("Phase 2 — Expand",
         "Scale community acquisition across SEA; broaden the partner campaign pipeline; localize onboarding.", "2"),
        ("Phase 3 — Distribution layer",
         "Self-serve partner tooling and ecosystem integrations — the default growth layer for Canton.", "3"),
    ], col_count=3, card_h=150))
    story.append(PageBreak())

    # ── SLIDE 11 — WHY NOW / CLOSING ────────────────────────────────────
    _header(story, "Why CanQuest, why now", "A monetized Canton growth engine.",
            "Canton needs user-facing products. CanQuest turns real activity into network revenue — and "
            "helps every other Canton project grow.")
    story.append(_spacer(20))
    story.extend(_bullets([
        ("Turns external users into active Canton participants.", ""),
        ("Turns quests and rewards into verified on-chain activity.", ""),
        ("Turns CC locks into recurring fee revenue for the network.", ""),
        ("Turns every partner campaign into ecosystem growth.", ""),
    ]))
    story.append(_spacer(30))
    story.append(Paragraph(
        "Let&apos;s build the growth layer for Canton together.",
        S(fontSize=20, leading=26, textColor=ACCENT_DARK),
    ))
    story.append(PageBreak())

    # ── SLIDE 12 — CONTACT ──────────────────────────────────────────────
    _header(story, "Get in touch", "", is_closing=True)
    story.append(_spacer(50))
    story.append(Paragraph(
        "CanQuest  ·  canquest.cc",
        S(fontSize=34, leading=40, textColor=INK),
    ))
    story.append(_spacer(10))
    story.append(Paragraph(
        "Canton-native growth platform for verified, active users.",
        S(fontSize=16, leading=22, textColor=MUTED),
    ))
    story.append(_spacer(30))
    story.append(Paragraph(
        "Partner / investment inquiries: use the partnership form at canquest.cc/cooperation, "
        "or reply to this conversation.",
        body,
    ))

    return story


def _spacer(h):
    """A vertical spacer flowable."""
    from reportlab.platypus import Spacer
    return Spacer(1, h)


def _header(story, eyebrow_text, title_text, desc_text="", is_closing=False):
    """Add the standard slide header (eyebrow + title + optional description)."""
    story.append(Paragraph(eyebrow_text.upper(), eyebrow))
    story.append(_spacer(6))
    story.append(Paragraph(title_text, slide_title if not is_closing else slide_title_lg))
    if desc_text:
        story.append(_spacer(8))
        story.append(Paragraph(desc_text, subtitle))


# ─── Build with per-page chrome ──────────────────────────────────────────────
def _make_on_page(total):
    def on_page(canvas, doc):
        page_no = canvas.getPageNumber()
        _DUMMY_CANVAS_HOLD[0] = canvas
        is_cover = (page_no == 1)
        _slide_chrome(canvas, page_no, total, is_cover=is_cover)
    return on_page


def main():
    from reportlab.platypus import SimpleDocTemplate

    if os.path.exists(OUT_PATH):
        os.remove(OUT_PATH)

    # Build story once to count pages, then build for real with correct total.
    tmp_story = build_story()
    # Count page breaks + 1
    total = 1 + sum(1 for el in tmp_story if isinstance(el, PageBreak))

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
