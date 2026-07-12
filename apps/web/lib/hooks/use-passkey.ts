"use client";

import { useCallback, useEffect, useState } from "react";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";

/**
 * usePasskey — hook untuk WebAuthn (passkey) gate transaksi.
 * Menggantikan useWalletPassword.
 *
 * Exposes:
 *   - hasPasskey: apakah user sudah enroll passkey (GET /api/party/passkey)
 *   - credentials: list device terdaftar (untuk Settings)
 *   - enrollPasskey(): full registration ceremony → return backup codes (first time)
 *   - authenticatePasskey(): full assertion ceremony → return verification token (90s JWT)
 *   - removeCredential(id): hapus device
 *   - refresh(): re-fetch status
 *
 * WebAuthn ceremony:
 *   1. GET options (challenge) dari backend
 *   2. startRegistration/startAuthentication (browser prompt Face ID/PIN)
 *   3. POST response ke backend verify → return result
 *
 * Passkey support check: window.PublicKeyCredential (browser modern).
 * Kalau undefined → device tidak support, fallback message di UI.
 */
export interface PasskeyCredentialInfo {
  id: string;
  deviceLabel: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function usePasskey(options: { enabled?: boolean } = {}) {
  const { enabled = true } = options;
  const [hasPasskey, setHasPasskey] = useState(false);
  const [credentials, setCredentials] = useState<PasskeyCredentialInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/party/passkey", {
        credentials: "include",
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          hasPasskey?: boolean;
          credentials?: PasskeyCredentialInfo[];
        };
        setHasPasskey(!!data.hasPasskey);
        setCredentials(data.credentials ?? []);
      }
    } catch {
      // Non-fatal.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void refresh();
  }, [enabled, refresh]);

  /** Cek browser support WebAuthn. */
  const isSupported = useCallback(() => {
    return typeof window !== "undefined" && "PublicKeyCredential" in window;
  }, []);

  /**
   * Enroll passkey baru (registration ceremony).
   * @param deviceLabel - optional label (mis. "iPhone 15")
   * @returns backup codes (10 kode) HANYA kalau first enrollment; null kalau add device.
   */
  const enrollPasskey = useCallback(
    async (deviceLabel?: string): Promise<string[] | null> => {
      // 1. Get registration options (challenge).
      const optsRes = await fetch(
        "/api/party/passkey/registration/options",
        { method: "POST", credentials: "include" },
      );
      if (!optsRes.ok) {
        throw new Error(`Registration options failed (${optsRes.status})`);
      }
      const opts = await optsRes.json();

      // 2. Browser ceremony (Face ID / Touch ID / PIN prompt).
      const attResp = await startRegistration(opts);

      // 3. Verify di backend.
      const verifyRes = await fetch(
        "/api/party/passkey/registration/verify",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: attResp, deviceLabel }),
        },
      );
      const result = (await verifyRes.json()) as {
        backupCodes?: string[] | null;
        message?: string;
      };
      if (!verifyRes.ok) {
        throw new Error(result.message ?? `Registration verify failed (${verifyRes.status})`);
      }

      // Refresh status (hasPasskey = true sekarang).
      void refresh();
      return result.backupCodes ?? null;
    },
    [refresh],
  );

  /**
   * Authenticate passkey (assertion ceremony) → verification token (90s JWT).
   * Token ini dikirim ke endpoint transaksi sebagai `txVerification`.
   */
  const authenticatePasskey = useCallback(async (): Promise<string> => {
    // 1. Get auth options (challenge + allowCredentials).
    const optsRes = await fetch(
      "/api/party/passkey/authentication/options",
      { method: "POST", credentials: "include" },
    );
    if (!optsRes.ok) {
      const err = (await optsRes.json().catch(() => null)) as {
        message?: string;
        code?: string;
      } | null;
      throw new Error(err?.message ?? `Auth options failed (${optsRes.status})`);
    }
    const opts = await optsRes.json();

    // 2. Browser ceremony (Face ID / PIN prompt).
    const asserResp = await startAuthentication(opts);

    // 3. Verify → verification token.
    const verifyRes = await fetch(
      "/api/party/passkey/authentication/verify",
      {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: asserResp }),
      },
    );
    const result = (await verifyRes.json()) as {
      verificationToken?: string;
      message?: string;
    };
    if (!verifyRes.ok || !result.verificationToken) {
      throw new Error(result.message ?? `Auth verify failed (${verifyRes.status})`);
    }
    return result.verificationToken;
  }, []);

  /** Hapus credential (device) dari Settings. */
  const removeCredential = useCallback(
    async (credentialId: string): Promise<void> => {
      const res = await fetch(
        `/api/party/passkey/${encodeURIComponent(credentialId)}`,
        { method: "DELETE", credentials: "include" },
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(err?.message ?? `Remove failed (${res.status})`);
      }
      void refresh();
    },
    [refresh],
  );

  return {
    hasPasskey,
    credentials,
    loading,
    refresh,
    setHasPasskey,
    isSupported,
    enrollPasskey,
    authenticatePasskey,
    removeCredential,
  };
}
