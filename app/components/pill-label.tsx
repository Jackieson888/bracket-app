"use client";

import { Box } from "@mui/material";
import type { ReactNode } from "react";

export default function PillLabel({ children }: { children: ReactNode }) {
  return (
    <Box
      sx={{
        position: "absolute",
        top: "-11px",
        left: "16px",
        zIndex: 2,
        backgroundColor: "var(--primary)",
        color: "var(--card)",
        fontFamily: "var(--font-heading)",
        fontSize: "11px",
        fontWeight: 700,
        letterSpacing: "1.5px",
        padding: "4px 12px",
        borderRadius: "999px",
      }}
    >
      {children}
    </Box>
  );
}
