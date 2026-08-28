"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * ModalPortal — render overlay langsung di document.body.
 *
 * Shell aplikasi memakai `isolate` + rail sidebar `z-40`; modal yang dirender
 * di dalam subtree halaman bisa terjebak stacking context ancestor (transform,
 * motion, isolate) sehingga muncul DI BELAKANG menu desktop. Portal ke body
 * memastikan backdrop menutup + memburamkan seluruh shell, tidak saling timpa.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
