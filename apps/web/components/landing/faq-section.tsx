import { ChevronDown } from "lucide-react";
import { LandingSection } from "@/components/landing/landing-section";
import { SectionHeader } from "@/components/landing/section-header";

/**
 * FAQ — native <details>/<summary>, no JS.
 *
 * Rule: hanya bahas hal yang BELUM dijelaskan di section lain.
 * Yang sudah ada gambarnya (lock, swap, wallet) tidak diulang di sini.
 */
const faqs = [
  {
    q: "CC saya hilang waktu di-lock?",
    a: "Tidak. CC tetap di wallet kamu sendiri lewat AmuletRules, dan balik utuh pas di-unlock. Yang ada cuma biaya holding kecil selama lock — pokoknya tidak dipotong.",
  },
  {
    q: "Reward quest ada jenis apa aja?",
    a: "Empat: First-come-first-served (slot yang bisa habis), Raffle (admin undi pemenang), Invite code (buka kode partner setelah fee), dan CC + Code raffle (gabungan CC + kode). Tiap kampanye tentuin sendiri mau pakai yang mana.",
  },
  {
    q: "Kirim CC atau USDCx dikenakan fee?",
    a: "Ya. Keduanya pakai transfer CIP-56 Canton. Sebagian kecil dari amount dialihkan ke treasury party sebagai platform fee. Fee udah ditampilin di preview sebelum kamu konfirmasi.",
  },
  {
    q: "Pair swap yang tersedia?",
    a: "Saat ini CC ↔ USDCx. Pair lain menyusul — saat ini masih Beta.",
  },
  {
    q: "Kenapa wallet-nya custodial?",
    a: "Supaya onboarding gampang: daftar email + kode invite, bukan urus private key. Operator yang submit command ke ledger, tapi saldo dan transaksi kamu tetap record nyata on-chain di Canton — bukan angka off-chain di database.",
  },
  {
    q: "Cara dapet invite code?",
    a: "Dari tim CanQuest atau partner. Wallet creation di-gate oleh kode invite dengan kuota harian. Tanpa kode, belum bisa bikin party ID.",
  },
  {
    q: "Gimana CaraQuest ngehindarin bot/farming?",
    a: "Satu party ID per orang yang terverifikasi lewat invite-gated — bot farming mahal di sini. Quest, poin, dan reward draw ditentukan di server dengan audit trail, bukan di browser, jadi gak bisa dimanipulasi client-side.",
  },
];

export function FaqSection() {
  return (
    <LandingSection id="faq">
      <SectionHeader
        eyebrow="FAQ"
        title="Pertanyaan umum"
        align="center"
        className="mb-8 md:mb-10"
      />
      <div className="mx-auto max-w-3xl divide-y divide-[var(--border)] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)]/40">
        {faqs.map((item) => (
          <details key={item.q} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--primary)]/5 sm:px-6 sm:text-base">
              {item.q}
              <ChevronDown
                className="h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="px-5 pb-5 text-sm leading-relaxed text-[var(--muted-foreground)] sm:px-6">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </LandingSection>
  );
}
