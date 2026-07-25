"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface UserProviderProps {
  user?: unknown;
  children: ReactNode;
}

const UserContext = createContext<{
  user: unknown | null;
  setGuestMode: React.Dispatch<React.SetStateAction<boolean>>;
} | null>(null);

export default function UserProvider({ user, children }: UserProviderProps) {
  const [guestMode, setGuestMode] = useState(false);

  const effectiveUser = user ?? (guestMode ? { guest: true } : null);

  return (
    <UserContext.Provider value={{ user: effectiveUser, setGuestMode }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
