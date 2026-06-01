"use client";



import { SettingsAccountPanel } from "@/components/app/settings/settings-account-panel";
import { SettingsTwitterPanel } from "@/components/app/settings/settings-twitter-panel";

import { SignOutButton } from "@/components/app/shell/sign-out-button";



export function SettingPageContent() {

  return (

    <div className="grid w-full min-w-0 gap-6 pb-10 md:gap-8">

      <SettingsAccountPanel />

      <SettingsTwitterPanel />

      <div className="flex justify-center pb-4 pt-4">

        <SignOutButton variant="link" />

      </div>

    </div>

  );

}

