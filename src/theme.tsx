"use client";
import { createTheme } from "@mui/material/styles";

const theme = createTheme({
  colorSchemes: { light: true },
  cssVariables: {
    colorSchemeSelector: "class",
  },
  typography: {
    fontFamily: "var(--font-roboto)",
  },
  palette: {
    common: {
      black: "#0B1313",
      white: "#F4F4F4",
    },
    primary: {
      main: "#123F3E",
    },
    secondary: {
      main: "#A73E26",
    },
    info: {
      main: "#E79F7F",
    },
    warning: {
      main: "#BDDDF4",
    },
    background: {
      default: "#F4F4F4",
      paper: "#B1CDC6",
    },
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: "#162727",
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
          borderRadius: "12px",
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          "&:last-child": {
            paddingBottom: "16px",
          },
          borderRadius: "12px",
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
  },
});

export default theme;
