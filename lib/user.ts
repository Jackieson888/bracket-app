type AuthUser = {
  name?: string | null;
  nickname?: string | null;
  email?: string | null;
  picture?: string | null;
} | null;

export type PublicUser = { name: string; picture: string | null } | { guest: true };

export function toPublicUser(user: AuthUser): PublicUser {
  if (!user) {
    return { guest: true };
  }

  return {
    name: user.name || user.nickname || user.email || "Host",
    picture: user.picture ?? null,
  };
}
