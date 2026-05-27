import { Coins } from "lucide-react";
import { getCcRewardLogoUrl } from "@/lib/cc-reward-logo";
import { cn } from "@/lib/utils";

type CcRewardLogoProps = {
  className?: string;
  size?: number;
  /** Lucide Coins when URL missing (default true). */
  fallbackIcon?: boolean;
};

export function CcRewardLogo({
  className,
  size = 24,
  fallbackIcon = true,
}: CcRewardLogoProps) {
  const url = getCcRewardLogoUrl();
  if (!url) {
    if (!fallbackIcon) return null;
    return (
      <Coins
        className={cn("shrink-0 text-canton", className)}
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
      aria-hidden
    />
  );
}
