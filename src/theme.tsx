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
  palette: {
    mode: "dark",
    common: {
      black: "#211A2E",
      white: "#F2EEF7",
    },
    primary: {
      main: "#E6A3B8",
      dark: "#D488A0",
      contrastText: "#241C34",
    },
    secondary: {
      main: "#8FD6C9",
      contrastText: "#241C34",
    },
    info: {
      main: "#F0C69F",
      contrastText: "#241C34",
    },
    warning: {
      main: "#E6A3B8",
      contrastText: "#241C34",
    },
    success: {
      main: "#8FD6C9",
      contrastText: "#241C34",
    },
    background: {
      default: "#211A2E",
      paper: "#241C34",
    },
    text: {
      primary: "#F2EEF7",
      secondary: "#9184AD",
    },
    divider: "rgba(255,255,255,0.08)",
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: "#241C34",
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
          backgroundColor: "#2C2440",
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
          color: "#241C34",
          background: "#E6A3B8",
          fontWeight: "bold",
        },
      },
    },
  },
});

export default theme;
