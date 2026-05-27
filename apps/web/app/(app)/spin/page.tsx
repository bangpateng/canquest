import { redirect } from "next/navigation";

/** Legacy route — menu uses Spin Reward at /spin-reward. */
export default function SpinPage() {
  redirect("/spin-reward");
}
