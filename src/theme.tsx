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
      black: "#0F1B22",
      white: "#F3EFE6",
    },
    primary: {
      main: "#F2734F",
      dark: "#D9603F",
      contrastText: "#1A0D08",
    },
    secondary: {
      main: "#8FC9C0",
      contrastText: "#12262A",
    },
    info: {
      main: "#D9A85C",
      contrastText: "#1A0D08",
    },
    warning: {
      main: "#D9718A",
      contrastText: "#1A0D08",
    },
    success: {
      main: "#3A6E68",
      contrastText: "#D9F2EC",
    },
    background: {
      default: "#0F1B22",
      paper: "#1C2C38",
    },
    text: {
      primary: "#F3EFE6",
      secondary: "#6D8A85",
    },
    divider: "rgba(255,255,255,0.08)",
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: "#1C2C38",
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
          backgroundColor: "#24343E",
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
          color: "#1A0D08",
          background: "#F2734F",
          fontWeight: "bold",
        },
      },
    },
  },
});

export default theme;
