"use client";

import { Box, BottomNavigation, BottomNavigationAction, Paper } from "@mui/material";
import {
  PlayArrowRounded,
  AddRounded,
  SupervisorAccountRounded,
} from "@mui/icons-material";
import { usePathname, useRouter } from "next/navigation";

const TABS = [
  { label: "Play", value: "/play", Icon: PlayArrowRounded },
  { label: "Create", value: "/create", Icon: AddRounded },
  { label: "Profile", value: "/profile", Icon: SupervisorAccountRounded },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/") {
    return null;
  }

  const activeValue =
    TABS.find((tab) => pathname?.startsWith(tab.value))?.value ?? false;

  return (
    <Paper
      elevation={0}
      sx={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 1100,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        backgroundColor: "rgba(var(--background-rgb),0.92)",
        backdropFilter: "blur(6px)",
        borderRadius: 0,
      }}
    >
      <BottomNavigation
        showLabels
        value={activeValue}
        onChange={(_event, newValue: string) => {
          router.push(newValue);
        }}
        sx={{
          maxWidth: 480,
          mx: "auto",
          backgroundColor: "transparent",
          "& .MuiBottomNavigationAction-root": {
            color: "var(--sub)",
            opacity: 0.55,
            minWidth: 0,
          },
          "& .MuiBottomNavigationAction-label": {
            fontFamily: "var(--font-heading)",
            fontSize: "11px",
            letterSpacing: "1.5px",
          },
          "& .Mui-selected": {
            color: "var(--primary)",
            opacity: 1,
          },
        }}
      >
        {TABS.map(({ label, value, Icon }) => {
          const isActive = value === activeValue;
          return (
            <BottomNavigationAction
              key={value}
              label={label}
              value={value}
              icon={
                <Box
                  sx={{
                    width: "34px",
                    height: "34px",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isActive
                      ? "rgba(var(--primary-rgb),0.18)"
                      : "transparent",
                    boxShadow: isActive
                      ? "0 0 14px rgba(var(--primary-rgb),0.25)"
                      : "none",
                  }}
                >
                  <Icon fontSize="small" />
                </Box>
              }
            />
          );
        })}
      </BottomNavigation>
    </Paper>
  );
}
