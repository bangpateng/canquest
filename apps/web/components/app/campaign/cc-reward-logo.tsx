import { getCcRewardLogoUrl } from "@/lib/canton/cc-reward-logo";
import { cn } from "@/lib/utils/utils";

type CcRewardLogoProps = {
  className?: string;
  size?: number;
  /** Gradient "C" coin when URL missing (default true). */
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
    // Amber gradient "C" coin — matches the CC token logo used elsewhere.
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 font-bold text-black",
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
        aria-hidden
      >
        C
      </span>
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
