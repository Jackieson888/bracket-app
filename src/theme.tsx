"use client";
import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  colorSchemes: { dark: true },
  cssVariables: {
    colorSchemeSelector: "class",
  },
  typography: {
    fontFamily: "var(--font-body)",
    h1: { fontFamily: "var(--font-heading)", letterSpacing: 1 },
    h2: { fontFamily: "var(--font-heading)", letterSpacing: 1 },
    h3: { fontFamily: "var(--font-heading)", letterSpacing: 1 },
    h4: { fontFamily: "var(--font-heading)", letterSpacing: 1 },
    h5: { fontFamily: "var(--font-heading)", letterSpacing: 0.5 },
    h6: { fontFamily: "var(--font-heading)", letterSpacing: 0.5 },
  },
  // Palette values mirror the CSS custom properties defined in app/globals.css
  // (brand colors: sage #87BEB4, terracotta #C67664, deep teal #385D66) — keep in sync.
  palette: {
    mode: "dark",
    common: {
      black: "#0C1416",
      white: "#F1F4F4",
    },
    primary: {
      main: "#C67664",
      dark: "#9A5C4E",
      contrastText: "#152327",
    },
    secondary: {
      main: "#87BEB4",
      contrastText: "#152327",
    },
    info: {
      main: "#D8A296",
      contrastText: "#152327",
    },
    warning: {
      main: "#C67664",
      contrastText: "#152327",
    },
    success: {
      main: "#87BEB4",
      contrastText: "#152327",
    },
    background: {
      default: "#0C1416",
      paper: "#1F3338",
    },
    text: {
      primary: "#F1F4F4",
      secondary: "#9FB1B6",
    },
    divider: "rgba(255,255,255,0.08)",
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: "#152327",
        },
      },
    },
    MuiContainer: {
      styleOverrides: {
        root: ({ theme }) => ({
          paddingLeft: 0,
          paddingRight: 0,

          [theme.breakpoints.up("sm")]: {
            paddingLeft: 0,
            paddingRight: 0,
          },
        }),
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: "18px",
          backgroundImage: "none",
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          "&:last-child": {
            paddingBottom: "16px",
          },
          borderRadius: "18px",
        },
      },
    },
    MuiStack: {
      styleOverrides: {
        root: {
          width: "100%",
          alignItems: "center",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: "unset",
          fontWeight: "bold",
          borderRadius: "14px",
          transition: "transform 150ms ease",
          "&:hover": {
            transform: "scale(1.03)",
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontFamily: "var(--font-pill)",
          fontWeight: 700,
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: "outlined",
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: "#1F3338",
          borderRadius: "12px",
        },
        notchedOutline: {
          borderColor: "rgba(255,255,255,0.08)",
        },
      },
    },
    MuiBadge: {
      styleOverrides: {
        badge: {
          inset: "8px auto auto 8px",
          color: "#152327",
          background: "#C67664",
          fontWeight: "bold",
        },
      },
    },
  },
});

export default theme;
