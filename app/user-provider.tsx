"use client";

import { createContext, useContext, useState } from "react";

const UserContext = createContext(null);

export default function UserProvider({ user, children }) {
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
