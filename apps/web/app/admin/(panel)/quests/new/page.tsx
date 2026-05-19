import { QuestForm } from '@/components/admin/quest-form';

export default function NewQuestPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-space)] text-2xl font-semibold">
          Create Quest
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Fill in the details below. You can add tasks after creation.
        </p>
      </div>
      <QuestForm />
    </div>
  );
}
