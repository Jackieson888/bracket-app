import * as React from "react";
import { getAuth0 } from "../lib/auth0";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import "./globals.css";
import theme from "../src/theme";
import UserProvider from "./user-provider";
import { Container, Box } from "@mui/material";
import NavBar from "./components/nav-bar";

export default async function RootLayout(props: { children: React.ReactNode }) {
  let user = null;
  try {
    // Only attempt to initialize Auth0 when required environment variables are present.
    if (process.env.AUTH0_DOMAIN && process.env.AUTH0_CLIENT_ID) {
      const session = await getAuth0().getSession();
      user = session?.user ?? null;
    }
  } catch (e) {
    // If anything goes wrong (including during prerender), fall back to null user.
    user = null;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <UserProvider user={user}>
          <InitColorSchemeScript attribute="class" />
          <AppRouterCacheProvider options={{ enableCssLayer: true }}>
            <ThemeProvider theme={theme}>
              <CssBaseline />
              <NavBar />
              <Container maxWidth="md">
                <Box
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  {props.children}
                </Box>
              </Container>
            </ThemeProvider>
          </AppRouterCacheProvider>
        </UserProvider>
      </body>
    </html>
  );
}
