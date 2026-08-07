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

export type ParticipantRecord = {
  participantId: string;
  displayName?: string;
  authUserId?: string | null;
  joinedAt?: Date | string | number;
  lastSeenAt?: Date | string | number;
};

export type PublicParticipant = {
  participantId: string;
  displayName?: string;
  joinedAt?: Date | string | number;
};

// Strips authUserId (Auth0 sub) and lastSeenAt before a participant record
// leaves the server — authUserId must never reach other players in a room.
export function toPublicParticipant(
  participant: ParticipantRecord,
): PublicParticipant {
  return {
    participantId: participant.participantId,
    displayName: participant.displayName,
    joinedAt: participant.joinedAt,
  };
}
