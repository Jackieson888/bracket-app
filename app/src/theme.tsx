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
    primary: {
      main: "#123F3E",
    },
    secondary: {
      main: "#A73E26",
    },
    warning: {
      main: "#BDDDF4",
    },
    background: {
      default: "#F4F4F4",
      paper: "#B1CDC6",
    },
  },
});

export default theme;
