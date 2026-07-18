"use client";

import { SettingsAccountPanel } from "@/components/app/settings/settings-account-panel";
import { SettingsWalletPasswordPanel } from "@/components/app/settings/settings-wallet-password-panel";
import { SettingsPreapprovalPanel } from "@/components/app/settings/settings-preapproval-panel";
import { SettingsTwitterPanel } from "@/components/app/settings/settings-twitter-panel";
import { MigrationBanner } from "@/components/platform/migration-banner";
import { SignOutButton } from "@/components/app/shell/sign-out-button";

export function SettingPageContent() {
  return (
    <div className="w-full max-w-full min-w-0 overflow-x-hidden space-y-6 pb-10 md:space-y-8">
      <MigrationBanner />

      <SettingsAccountPanel />

      <SettingsWalletPasswordPanel />

      <SettingsPreapprovalPanel />

      <SettingsTwitterPanel />

      <div className="flex justify-center pb-4 pt-4">
        <SignOutButton variant="link" />
      </div>
    </div>
  );
}

