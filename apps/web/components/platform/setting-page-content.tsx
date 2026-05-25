"use client";



import { SettingsAccountPanel } from "@/components/app/settings/settings-account-panel";
import { SettingsTwitterPanel } from "@/components/app/settings/settings-twitter-panel";

import { SignOutButton } from "@/components/app/sign-out-button";



export function SettingPageContent() {

  return (

    <div className="grid w-full min-w-0 gap-8 pb-8">

      <SettingsAccountPanel />

      <SettingsTwitterPanel />

      <div className="flex justify-center pb-4 pt-2">

        <SignOutButton variant="link" />

      </div>

    </div>

  );

}

