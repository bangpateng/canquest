"use client";



import { SettingsAccountPanel } from "@/components/app/settings/settings-account-panel";
import { SettingsReferralPanel } from "@/components/app/settings/settings-referral-panel";
import { SettingsTwitterPanel } from "@/components/app/settings/settings-twitter-panel";

import { SignOutButton } from "@/components/app/sign-out-button";



export function SettingPageContent() {

  return (

    <div className="mx-auto grid w-full min-w-0 max-w-3xl gap-8 pb-8">

      <SettingsAccountPanel />

      <SettingsReferralPanel />

      <SettingsTwitterPanel />

      <div className="flex justify-center pb-4 pt-2">

        <SignOutButton variant="link" />

      </div>

    </div>

  );

}

