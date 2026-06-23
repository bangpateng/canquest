"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AuthModalMode = "login" | "register" | "forgot" | "reset";

type AuthContextValue = {
  open: boolean;
  mode: AuthModalMode;
  nextPath: string | null;
  openAuth: (mode?: AuthModalMode, next?: string | null) => void;
  closeAuth: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<AuthModalMode>("login");
  const [nextPath, setNextPath] = useState<string | null>(null);

  const openAuth = useCallback((m: AuthModalMode = "login", next?: string | null) => {
    setMode(m);
    setNextPath(next ?? null);
    setOpen(true);
  }, []);

  const closeAuth = useCallback(() => {
    setOpen(false);
    setNextPath(null);
  }, []);

  const value = useMemo(
    () => ({ open, mode, nextPath, openAuth, closeAuth }),
    [open, mode, nextPath, openAuth, closeAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthModal() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthModal must be used within AuthProvider");
  return ctx;
}
