"use client";

import { normalizeWalletUsername } from "@/lib/canton/canton-party-id";
import { cn } from "@/lib/utils/utils";
import { buttonVariants } from "@/components/ui/button";
import { inputClass } from "@/lib/ui/ui-tokens";
import { formatApiError } from "@/lib/api/format-api-error";
import { Wallet, Lock, CheckCircle2, ArrowLeft, MailCheck } from "lucide-react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { OtpInput } from "@/components/ui/otp-input";
import { Countdown } from "@/components/ui/countdown";
import { Card } from "@/components/ui/card";
import { PageTitle } from "@/components/ui/typography";
import { useEffect, useState } from "react";
import { usePlatformT } from "@/lib/i18n/platform-provider";
import { useMe } from "@/lib/hooks/use-me";
import { KeyCeremony } from "@/components/app/wallet/key-ceremony";
import { signBytesHex, signPreparedHash, tryDeviceAutoUnlock, type WalletKeyMeta } from "@/lib/wallet/key-manager";
import { signRelayTransaction } from "@/lib/wallet/sign-relay";

type Step = "form" | "otp" | "ceremony" | "registering" | "success";

interface WalletSetupProps {
  onCreated: () => void;
}

/**
 * Multi-step wallet creation form (Fase 1.5).
 *
 * State machine:
 *   form → (submit /party/wallet/otp/send) → otp
 *   otp  → (input 6 digit + submit /party/wallet/otp/verify) → success
 *   success → (auto-redirect via onCreated)
 *
 * Fields: email (read-only, verified badge), username, firstName, lastName
 * (optional, forwarded to Keycloak only), invite code (conditional).
 */
export function WalletSetup({ onCreated }: WalletSetupProps) {
  const t = usePlatformT();
  const { me } = useMe();

  const [username, setUsername] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [needsInvite, setNeedsInvite] = useState(true);
  const [externalEnabled, setExternalEnabled] = useState(false);
  const [otpExpiresAt, setOtpExpiresAt] = useState<string | null>(null);
  const [otpExpired, setOtpExpired] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(false);

  useEffect(() => {
    void fetch("/api/party/wallet-access", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            hasRedeemedInvite?: boolean;
            externalWalletEnabled?: boolean;
          } | null,
        ) => {
          if (data && typeof data.hasRedeemedInvite === "boolean") {
            setNeedsInvite(!data.hasRedeemedInvite);
          }
          if (data && typeof data.externalWalletEnabled === "boolean") {
            setExternalEnabled(data.externalWalletEnabled);
          }
        },
      )
      .catch(() => undefined);
  }, []);

  const email = me?.email ?? "";

  function resetOtpCooldown() {
    setResendCooldown(true);
    setTimeout(() => setResendCooldown(false), 120_000); // 2 menit
  }

  async function handleSubmitForOtp(e: React.FormEvent) {
    e.preventDefault();
    const val = normalizeWalletUsername(username) ?? "";
    if (!val || val.length < 3) return;
    if (needsInvite && inviteCode.trim().length < 4) return;

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/party/wallet/otp/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: val,
          ...(needsInvite ? { walletInviteCode: inviteCode.trim() } : {}),
        }),
      });

      const raw = (await res.json().catch(() => null)) as
        | { message?: string; expiresAt?: string; devOtp?: string }
        | null;

      if (!res.ok) {
        setError(formatApiError(raw));
        return;
      }

      setOtpExpiresAt(raw?.expiresAt ?? null);
      setOtp("");
      setOtpExpired(false);
      setStep("otp");
      resetOtpCooldown();

      // Dev convenience: kalau backend kirim devOtp (NODE_ENV !== production),
      // auto-isi supaya dev tidak perlu cek email.
      if (raw?.devOtp && /^[0-9]{6}$/.test(raw.devOtp)) {
        setOtp(raw.devOtp);
      }
    } catch (err) {
      setError(formatApiError(err, "Could not send verification code."));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e?: React.FormEvent) {
    e?.preventDefault();
    if (otp.length !== 6) return;

    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/party/wallet/otp/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: normalizeWalletUsername(username) ?? username,
          code: otp,
          ...(needsInvite ? { walletInviteCode: inviteCode.trim() } : {}),
        }),
      });

      const raw = (await res.json().catch(() => null)) as
        | (Record<string, unknown> & { needsKeyCeremony?: boolean })
        | null;

      if (!res.ok) {
        setError(formatApiError(raw));
        return;
      }

      // M2: jalur non-custodial — OTP valid, lanjut key ceremony di browser.
      if (raw?.needsKeyCeremony === true) {
        setStep("ceremony");
        return;
      }

      setStep("success");
      setTimeout(() => onCreated(), 1500);
    } catch (err) {
      setError(formatApiError(err, "Verification failed."));
    } finally {
      setBusy(false);
    }
  }

  /**
   * M2: registrasi wallet external setelah key ceremony selesai.
   * prepare (public key saja) → sign multiHash DI BROWSER → complete (signature).
   * Private key tidak pernah keluar dari perangkat.
   */
  async function registerExternalWallet(meta: WalletKeyMeta) {
    setBusy(true);
    setError(null);
    try {
      const prep = await fetch("/api/party/wallet-external/prepare", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publicKeyHex: meta.publicKeyHex,
          partyHint: meta.hint,
        }),
      });
      const prepRaw = (await prep.json().catch(() => null)) as {
        multiHash?: string;
      } | null;
      if (!prep.ok || !prepRaw?.multiHash) {
        setError(formatApiError(prepRaw, "Failed to prepare wallet registration."));
        setStep("form");
        return;
      }

      // Tanda tangan terjadi di browser, dengan kunci user.
      const signature = await signPreparedHash(prepRaw.multiHash);

      const comp = await fetch("/api/party/wallet-external/complete", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signature,
          username: normalizeWalletUsername(username) ?? username,
          ...(needsInvite ? { walletInviteCode: inviteCode.trim() } : {}),
        }),
      });
      const compRaw = (await comp.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      if (!comp.ok) {
        setError(formatApiError(compRaw, "Wallet registration failed."));
        setStep("form");
        return;
      }

      // M3: aktivasi WalletRegistration on-chain — di-sign browser (dompet
      // masih unlocked dari ceremony). Best-effort: kegagalan tidak menghalangi
      // wallet aktif (registrasi bisa diulang kapan saja).
      await signRelayTransaction("wallet_registration_accept").catch(() => {
        /* non-critical */
      });

      // v30 (AGENT.md): preapproval WAJIB — tanpa itu reward masuk menu offer
      // dan harus diterima manual. Chain langkah sign SEKARANG (dompet masih
      // unlocked). Best-effort: bisa diaktifkan kapan saja di Settings.
      if (compRaw?.preapprovalRequired === true) {
        await enablePreapprovalBestEffort(meta).catch(() => {
          /* non-critical — Settings → Instant receive */
        });
      }

      setStep("success");
      setTimeout(() => onCreated(), 1500);
    } catch (err) {
      setError(formatApiError(err, "Wallet registration failed."));
      setStep("form");
    } finally {
      setBusy(false);
    }
  }

  async function handleResendOtp() {
    if (resendCooldown || busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/party/wallet/otp/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: normalizeWalletUsername(username) ?? username,
          ...(needsInvite ? { walletInviteCode: inviteCode.trim() } : {}),
        }),
      });

      const raw = (await res.json().catch(() => null)) as
        | { expiresAt?: string; devOtp?: string }
        | null;

      if (!res.ok) {
        setError(formatApiError(raw));
        return;
      }

      setOtpExpiresAt(raw?.expiresAt ?? null);
      setOtp("");
      setOtpExpired(false);
      resetOtpCooldown();

      if (raw?.devOtp && /^[0-9]{6}$/.test(raw.devOtp)) {
        setOtp(raw.devOtp);
      }
    } catch (err) {
      setError(formatApiError(err, "Could not resend verification code."));
    } finally {
      setBusy(false);
    }
  }

  // ── Render step: OTP ─────────────────────────────────────────────────────
  if (step === "otp") {
    return (
      <div className="flex min-h-[60vh] w-full min-w-0 items-center justify-center">
        <Card className="w-full min-w-0 max-w-md overflow-hidden p-8 sm:p-10">
          <div>
            <div className="mb-8 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-canton-muted bg-canton-subtle">
                <MailCheck className="h-10 w-10 text-canton" />
              </div>
            </div>

            <PageTitle as="h2" className="text-center">
              {t("wallet.otpTitle")}
            </PageTitle>
            <p className="mt-3 text-center text-sm font-medium text-[var(--muted-foreground)]">
              {t("wallet.otpSubtitle")}{" "}
              <span className="font-semibold text-[var(--foreground)]">{email}</span>
            </p>

            <form onSubmit={handleVerifyOtp} className="mt-8 space-y-6">
              {otpExpiresAt ? (
                <div className="text-center">
                  <OtpInput
                    value={otp}
                    onChange={setOtp}
                    onComplete={(code) => {
                      setOtp(code);
                    }}
                    disabled={busy || otpExpired}
                  />
                  <p className="mt-3 text-xs font-medium text-[var(--muted-foreground)]">
                    {t("wallet.otpExpiresIn")}{" "}
                    <Countdown
                      expiresAt={otpExpiresAt}
                      onExpire={() => setOtpExpired(true)}
                      className={cn(
                        "font-mono font-semibold",
                        otpExpired ? "text-red-600" : "text-[var(--foreground)]",
                      )}
                    />
                  </p>
                </div>
              ) : null}

              {error ? (
                <p
                  className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-600"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy || otp.length !== 6 || otpExpired}
                className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
              >
                {busy ? <LoadingSpinner size="md" /> : null}
                {t("wallet.verifyAndCreate")}
              </button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setStep("form");
                    setError(null);
                    setOtp("");
                  }}
                  className="flex items-center gap-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t("wallet.backToForm")}
                </button>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={resendCooldown || busy}
                  className={cn(
                    "font-semibold",
                    resendCooldown
                      ? "cursor-not-allowed text-[var(--muted-foreground)]"
                      : "text-canton hover:underline",
                  )}
                >
                  {resendCooldown ? t("wallet.resendIn") : t("wallet.resendCode")}
                </button>
              </div>
            </form>
          </div>
        </Card>
      </div>
    );
  }

  // ── Render step: CEREMONY (non-custodial, M2) ─────────────────────────────
  if (step === "ceremony") {
    return (
      <div className="flex min-h-[60vh] w-full min-w-0 items-center justify-center">
        <KeyCeremony
          replaceStaleKey
          onCancel={() => {
            setStep("form");
            setError(null);
          }}
          onComplete={(meta) => {
            setStep("registering");
            void registerExternalWallet(meta);
          }}
        />
      </div>
    );
  }

  // ── Render step: REGISTERING (signature + allocate berjalan) ─────────────
  if (step === "registering") {
    return (
      <div className="flex min-h-[60vh] w-full min-w-0 items-center justify-center">
        <Card className="w-full min-w-0 max-w-md overflow-hidden p-8 text-center sm:p-10">
          <div className="mb-6 flex justify-center">
            <LoadingSpinner size="lg" />
          </div>
          <PageTitle as="h2">Creating Your Wallet</PageTitle>
          <p className="mt-3 text-sm font-medium text-[var(--muted-foreground)]">
            Registering your party on the CanQuest validator — your key stays
            safe in this browser.
          </p>
        </Card>
      </div>
    );
  }

  // ── Render step: SUCCESS ─────────────────────────────────────────────────
  if (step === "success") {
    return (
      <div className="flex min-h-[60vh] w-full min-w-0 items-center justify-center">
        <Card className="w-full min-w-0 max-w-md overflow-hidden p-8 text-center sm:p-10">
          <div>
            <div className="mb-8 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-emerald-500/30 bg-emerald-500/10">
                <CheckCircle2 className="h-10 w-10 text-emerald-600" />
              </div>
            </div>
            <PageTitle as="h2">{t("wallet.successTitle")}</PageTitle>
            <p className="mt-3 text-sm font-medium text-[var(--muted-foreground)]">
              {t("wallet.successSubtitle")}
            </p>
            <div className="mt-6 flex items-center justify-center gap-2 text-canton">
              <LoadingSpinner size="sm" />
              <span className="text-sm">{t("wallet.walletCreatedLoading")}</span>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  // ── Render step: FORM (default) ──────────────────────────────────────────
  return (
    <div className="flex min-h-[60vh] w-full min-w-0 items-center justify-center">
      <Card className="w-full min-w-0 max-w-md overflow-hidden p-8 sm:p-10">
        <div>
          <div className="mb-8 flex justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-canton-muted bg-canton-subtle">
              <Wallet className="h-10 w-10 text-canton" />
            </div>
          </div>

          <PageTitle as="h2" className="text-center">
            {t("wallet.createTitle")}
          </PageTitle>

          <form onSubmit={handleSubmitForOtp} className="mt-10 space-y-6">
            {/* Email (read-only, verified via Google badge) */}
            {email ? (
              <div className="space-y-2">
                <label
                  htmlFor="wallet-email"
                  className="text-sm font-medium text-[var(--muted-foreground)]"
                >
                  {t("wallet.emailLabel")}
                </label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
                  <input
                    id="wallet-email"
                    value={email}
                    readOnly
                    className={cn(inputClass, "pl-10 opacity-80")}
                  />
                </div>
                <p className="flex items-center gap-1 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t("wallet.emailVerified")}
                </p>
              </div>
            ) : null}

            <div className="space-y-2">
              <label
                htmlFor="wallet-username"
                className="text-sm font-medium text-[var(--muted-foreground)]"
              >
                {t("wallet.usernameLabel")}
              </label>
              <input
                id="wallet-username"
                value={username}
                onChange={(e) =>
                  setUsername(
                    e.target.value.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9_]/g, ""),
                  )
                }
                minLength={3}
                maxLength={32}
                pattern="[a-z0-9_]+"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                required
                disabled={busy}
                className={cn(inputClass, "font-mono")}
              />
            </div>

            {/* First/last name (side-by-side, optional) */}
            
            {needsInvite ? (
              <div className="space-y-2">
                <label
                  htmlFor="wallet-invite-code"
                  className="text-sm font-medium text-[var(--muted-foreground)]"
                >
                  {t("wallet.inviteCodeLabel")}
                </label>
                <input
                  id="wallet-invite-code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.replace(/\s+/g, ""))}
                  placeholder="Invite code"
                  minLength={4}
                  maxLength={64}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  disabled={busy}
                  className={cn(inputClass, "font-mono")}
                />
              </div>
            ) : null}

            {error ? (
              <p
                className="rounded-2xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm font-medium text-orange-600"
                role="alert"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={
                busy ||
                username.trim().length < 3 ||
                (needsInvite && inviteCode.trim().length < 4)
              }
              className={cn(buttonVariants({ size: "lg" }), "w-full gap-2")}
            >
              {busy ? (
                <>
                  <LoadingSpinner size="md" />
                  {t("wallet.sendingCode")}
                </>
              ) : (
                <>
                  <Wallet className="h-5 w-5" />
                  {t("wallet.sendOtpButton")}
                </>
              )}
            </button>

            {externalEnabled ? (
              <p className="text-center text-xs leading-relaxed text-[var(--muted-foreground)]">
                🔒 Non-custodial wallet — your private key is created and
                stored in this browser, never sent to a server.
              </p>
            ) : null}

          </form>
        </div>
      </Card>
    </div>
  );
}

/**
 * v30: aktifkan CC preapproval (instant receive) segera setelah wallet aktif —
 * AGENT.md: tanpa preapproval, reward masuk menu offer dan harus diterima
 * manual. Jalur validator API dgn hash RAW 32 bytes (TANPA 1220 prefix) —
 * BERBEDA dari relay biasa (mirror settings-preapproval-panel). Best-effort:
 * dompet masih unlocked dari ceremony; kegagalan tidak memblokir wallet.
 */
async function enablePreapprovalBestEffort(meta: WalletKeyMeta): Promise<void> {
  const prepRes = await fetch("/api/party/sign/preapproval/prepare", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKeyHex: meta.publicKeyHex }),
  });
  const prep = (await prepRes.json().catch(() => null)) as {
    hash?: string | null;
    alreadyEnabled?: boolean;
  } | null;
  if (!prepRes.ok || !prep?.hash || prep.alreadyEnabled) return;

  if (!(await tryDeviceAutoUnlock().catch(() => false))) {
    // Ceremony barusan unlock — kalau sudah terkunci lagi, biarkan Settings.
    return;
  }
  const hashBytes = new Uint8Array(
    (String(prep.hash).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)),
  );
  const sigHex = await signBytesHex(hashBytes);

  await fetch("/api/party/sign/preapproval/execute", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signature: sigHex }),
  });
}
