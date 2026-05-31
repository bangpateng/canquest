import { cn } from "@/lib/utils/utils";

type Props = {
  points: number;
  /** Verified / on cooldown — matches Quest hub row styling. */
  complete?: boolean;
  className?: string;
};

/** Task reward points — same canton color + `pts` suffix as Quest menu. */
export function TaskPointsLabel({ points, complete, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-baseline gap-1 text-sm font-bold tabular-nums",
        complete ? "text-emerald-400" : "text-canton",
        className,
      )}
    >
      +{points}
      <span className="text-xs font-semibold leading-none text-canton">pts</span>
    </span>
  );
}
