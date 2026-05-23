import { redirect } from "next/navigation";

/** Legacy URL — campaigns live under /admin/earn */
export default function NewQuestPage() {
  redirect("/admin/earn/new");
}