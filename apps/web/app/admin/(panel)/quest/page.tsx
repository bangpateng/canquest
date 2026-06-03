import { redirect } from "next/navigation";

/** /admin/quest → /admin/quests (redirect permanen) */
export default function AdminQuestRedirectPage() {
  redirect("/admin/quests");
}
