"use client";

import Person from "@mui/icons-material/Person";

// Renders a player's initials, or a generic account icon when there is no
// name to abbreviate. Anonymous players used to render as the literal "GU",
// which read like someone whose name started with those letters.
export default function AvatarGlyph({
  initials,
  size = 13,
}: {
  initials: string | null;
  size?: number;
}) {
  if (initials) {
    return <>{initials}</>;
  }

  return (
    <Person role="img" aria-label="Unnamed player" sx={{ fontSize: size }} />
  );
}
