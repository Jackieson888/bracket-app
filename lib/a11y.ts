import type { KeyboardEvent } from "react";

export function onActivateKeyDown(onActivate: () => void) {
  return (event: KeyboardEvent) => {
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      onActivate();
    }
  };
}

export const focusableButtonSx = {
  outline: "2px solid transparent",
  outlineOffset: "2px",
  "&:focus-visible": {
    outline: "2px solid var(--primary)",
  },
} as const;
