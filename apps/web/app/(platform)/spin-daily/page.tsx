import { redirect } from "next/navigation";

/** Legacy route — menu renamed to Spin Reward. */
export default function SpinDailyRedirectPage() {
  redirect("/spin-reward");
}
