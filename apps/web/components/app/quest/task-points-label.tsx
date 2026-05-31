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
        "inline-flex shrink-0 items-baseline gap-0.5 text-xs font-semibold tabular-nums",
        complete ? "text-emerald-400/90" : "text-canton",
        className,
      )}
    >
      +{points}
      <span className="text-[10px] font-medium leading-none text-canton/90">pts</span>
    </span>
  );
}
