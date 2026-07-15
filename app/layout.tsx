import * as React from "react";
import { auth0 } from "@/lib/auth0";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import InitColorSchemeScript from "@mui/material/InitColorSchemeScript";
import "./globals.css";
import theme from "../src/theme";
import UserProvider from "./user-provider";
import { Container, Box } from "@mui/material";

export default async function RootLayout(props: { children: React.ReactNode }) {
  const session = await auth0.getSession();
  const user = session?.user ?? null;

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <UserProvider user={user}>
          <InitColorSchemeScript attribute="class" />
          <AppRouterCacheProvider options={{ enableCssLayer: true }}>
            <ThemeProvider theme={theme}>
              <CssBaseline />
              <Container maxWidth="md">
                <Box
                  sx={{
                    my: 2,
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
