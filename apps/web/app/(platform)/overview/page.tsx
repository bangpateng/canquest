import { redirect } from "next/navigation";

/** /overview has been renamed to /ecosystem — permanent redirect. */
export default function OverviewRedirect() {
  redirect("/ecosystem");
}
