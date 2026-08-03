"use client";

import * as React from "react";
import {
  AppBar,
  Box,
  Toolbar,
  Menu,
  MenuItem,
  IconButton,
  Button,
  Avatar,
  Stack,
} from "@mui/material";
import { useState } from "react";
import { useUser } from "../user-provider";
import Image from "next/image";

export default function NavBar() {
  const userContext = useUser() as {
    user: { name?: string; picture?: string } | null;
  } | null;
  const { user } = userContext || { user: null };
  const [anchorElUser, setAnchorElUser] = useState<null | HTMLElement>(null);

  const handleOpenUserMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElUser(event.currentTarget);
  };

  const handleCloseUserMenu = () => {
    setAnchorElUser(null);
  };

  return (
    <Box sx={{ flexGrow: 1 }}>
      <AppBar position="static">
        <Toolbar variant="dense">
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
