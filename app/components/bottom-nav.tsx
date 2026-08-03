"use client";

import { BottomNavigation, BottomNavigationAction, Paper } from "@mui/material";
import PlayArrowRounded from "@mui/icons-material/PlayArrowRounded";
import AddRounded from "@mui/icons-material/AddRounded";
import { usePathname, useRouter } from "next/navigation";

const TABS = [
  { label: "Play", value: "/play", icon: <PlayArrowRounded /> },
  { label: "Create", value: "/create", icon: <AddRounded /> },
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

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
        borderTop: "1px solid",
        borderColor: "divider",
        backgroundColor: "background.paper",
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
            color: "text.secondary",
            minWidth: 0,
          },
          "& .Mui-selected": {
            color: "primary.main",
          },
        }}
      >
        {TABS.map((tab) => (
          <BottomNavigationAction
            key={tab.value}
            label={tab.label}
            value={tab.value}
            icon={tab.icon}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
