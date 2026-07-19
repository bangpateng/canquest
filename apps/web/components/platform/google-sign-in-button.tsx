"use client";

import { GoogleLogin } from "@react-oauth/google";
import { buttonVariants } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { formatApiError } from "@/lib/api/format-api-error";
import { loginWithGoogle } from "@/lib/services/api/auth";
import { clearCachedWalletMe } from "@/lib/auth/wallet-session-cache";
import { getReferralRef, clearReferralRef } from "@/lib/routing/referral-ref";
import { cn } from "@/lib/utils/utils";

/**
 * Tombol "Continue with Google" untuk auth modal.
 *
 * Pakai GoogleLogin component dari @react-oauth/google yang wrap Google
 * Identity Services button. GIS button render style official Google (trust)
 * tapi tetap dalam container yang match design system.
 *
 * On success → dapat `credential` (Google ID Token) → POST BFF /api/auth/google
 * → backend verifyIdToken + issue JWT CanQuest → setAuthCookies.
 *
 * REFERRAL (Fase 1 patch):
 *   - Baca `getReferralRef()` dari sessionStorage (link ?ref= atau input manual).
 *   - Kirim ke backend sebagai `referralCode` opsional. Backend hanya apply
 *     untuk user BARU; existing user → diabaikan.
 *   - Setelah sukses login, `clearReferralRef()` supaya sessionStorage bersih.
 *
 * Catatan: kita TIDAK pakai useGoogleLogin (itu OAuth flow, return access_token
 * / auth code, BUKAN id_token). Backend auth.service.loginWithGoogle verify
 * ID Token (signature + audience) — bukan OAuth code exchange.
 */
export function GoogleSignInButton({
  onSuccess,
  onError,
  /** Override referral code (mis. dari input manual di form register). */
  referralOverride,
}: {
  onSuccess: () => void;
  onError: (message: string) => void;
  referralOverride?: string;
}) {
  if (!process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID) {
    // Fallback: kalau Google Client ID belum di-set, tombol disabled + pesan.
    return (
      <button
        type="button"
        disabled
        className={cn(
          buttonVariants({ variant: "secondary", size: "block" }),
          "gap-2 cursor-not-allowed opacity-60",
        )}
      >
        <GoogleGIcon />
        Google sign-in not configured
      </button>
    );
  }

  return (
    <div className="flex justify-center">
      <GoogleLogin
        onSuccess={async (credentialResponse) => {
          const idToken = credentialResponse.credential;
          if (!idToken) {
            onError("Google sign-in failed: no credential returned.");
            return;
          }
          // Referral priority: override (input manual) > sessionStorage (?ref=).
          const referralCode =
            referralOverride?.trim() || getReferralRef() || undefined;
          try {
            await loginWithGoogle(idToken, referralCode);
            clearCachedWalletMe();
            clearReferralRef();
            onSuccess();
          } catch (err) {
            onError(
              formatApiError(err, "Google sign-in failed. Please try again."),
            );
          }
        }}
        onError={() => {
          onError("Google sign-in was cancelled or failed.");
        }}
        text="continue_with"
        shape="circle"
        size="large"
        width="320"
        locale="en"
      />
    </div>
  );
}

/** Fallback "G" icon for the disabled state. */
function GoogleGIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
