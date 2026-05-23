import { QuestForm } from "@/components/admin/quest-form";

export default function NewEarnCampaignPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="type-page-title">New Earn campaign</h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Shown in the user <strong>Earn</strong> menu. Add tasks after saving.
        </p>
      </div>
      <QuestForm questKind="CAMPAIGN" redirectBase="/admin/earn" />
    </div>
  );
}
