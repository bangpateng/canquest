import { ProfileAvatarService } from './profile-avatar.service';

type AvatarUser = {
  id: string;
  avatarPath: string | null;
  twitterAvatarUrl?: string | null;
};

/** Uploaded avatar wins; else Twitter CDN URL from registration. */
export function resolvePublicAvatarUrl(
  avatars: ProfileAvatarService,
  user: AvatarUser,
): string | null {
  if (avatars.hasAvatar(user.avatarPath)) {
    return avatars.avatarPublicPath(user.id);
  }
  const tw = user.twitterAvatarUrl?.trim();
  if (tw?.startsWith('https://')) return tw;
  return null;
}
