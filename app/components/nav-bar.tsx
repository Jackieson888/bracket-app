"use client";

import * as React from "react";
import {
  AppBar,
  Box,
  Toolbar,
  Typography,
  Menu,
  MenuItem,
  IconButton,
  Button,
  Avatar,
  Stack,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { useState } from "react";
import { useUser } from "../user-provider";
import Image from "next/image";

export default function NavBar() {
  const userContext = useUser() as {
    user: { name?: string; picture?: string } | null;
  } | null;
  const { user } = userContext || { user: null };
  const [anchorElUser, setAnchorElUser] = useState<null | HTMLElement>(null);
  const [anchorElApp, setAnchorElApp] = useState<null | HTMLElement>(null);

  const handleOpenUserMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElUser(event.currentTarget);
  };

  const handleCloseUserMenu = () => {
    setAnchorElUser(null);
  };

  const handleOpenAppMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElApp(event.currentTarget);
  };

  const handleCloseAppMenu = () => {
    setAnchorElApp(null);
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar variant="dense">
          <Box sx={{ flexGrow: 0 }}>
            <IconButton
              onClick={handleOpenAppMenu}
              size="large"
              edge="start"
              color="inherit"
              aria-label="menu"
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>

            <Menu
              sx={{ mt: "45px" }}
              id="menu-appbar"
              anchorEl={anchorElApp}
              anchorOrigin={{
                vertical: "top",
                horizontal: "right",
              }}
              keepMounted
              transformOrigin={{
                vertical: "top",
                horizontal: "right",
              }}
              open={Boolean(anchorElApp)}
              onClose={handleCloseAppMenu}
            >
              <MenuItem onClick={handleCloseAppMenu}>
                <Button fullWidth variant="contained" size="large" href="/play">
                  Play
                </Button>
              </MenuItem>
              <MenuItem onClick={handleCloseAppMenu}>
                <Button
                  fullWidth
                  variant="contained"
                  size="large"
                  href="/create"
                >
                  Create
                </Button>
              </MenuItem>
              {user && (
                <MenuItem onClick={handleCloseAppMenu}>
                  <Button
                    fullWidth
                    variant="contained"
                    size="large"
                    href="/my-brackets"
                  >
                    My Brackets
                  </Button>
                </MenuItem>
              )}
            </Menu>
          </Box>
          <Box sx={{ width: "stretch" }}>
            <Image
              loading="eager"
              src="/TvT_Logo.svg"
              alt="This vs That"
              width={250}
              height={40}
            />
          </Box>
          {!user && (
            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                size="large"
                href="/auth/login?screen_hint=signup"
              >
                Signup
              </Button>
              <Button variant="contained" size="large" href="/auth/login">
                Login
              </Button>
            </Stack>
          )}

          {user && (
            <Box sx={{ flexGrow: 0 }}>
              <IconButton onClick={handleOpenUserMenu} sx={{ p: 0 }}>
                <Avatar alt={user.name ?? ""} src={user.picture ?? undefined} />
              </IconButton>

              <Menu
                sx={{ mt: "45px" }}
                id="menu-appbar"
                anchorEl={anchorElUser}
                anchorOrigin={{
                  vertical: "top",
                  horizontal: "right",
                }}
                keepMounted
                transformOrigin={{
                  vertical: "top",
                  horizontal: "right",
                }}
                open={Boolean(anchorElUser)}
                onClose={handleCloseUserMenu}
              >
                <MenuItem onClick={handleCloseUserMenu}>
                  <Button variant="contained" size="large" href="/auth/logout">
                    Logout
                  </Button>
                </MenuItem>
              </Menu>
            </Box>
          )}
        </Toolbar>
      </AppBar>
    </Box>
  );
}
