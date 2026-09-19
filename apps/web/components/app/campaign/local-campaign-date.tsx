"use client";

import { useEffect, useState } from "react";
import { formatEndMeta } from "@/lib/canton/campaign-reward";

export function LocalCampaignDate({
  iso,
}: {
  iso: string | null | undefined;
}) {
  const [formatted, setFormatted] = useState<string | null>(null);

  useEffect(() => {
    setFormatted(formatEndMeta(iso));
  }, [iso]);

  return <>{formatted ?? "—"}</>;
}
