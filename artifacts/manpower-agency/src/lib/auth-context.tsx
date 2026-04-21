import React, { createContext, useContext, useEffect, useRef } from "react";
import { useGetMe, useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import type { User } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  logout: () => void;
  isAuthenticated: boolean;
}

const AUTH_QUERY_KEY = `/api/auth/me`;
const RESTRICTED_STATUSES = ["rejected", "blacklisted"] as const;
type RestrictedStatus = (typeof RESTRICTED_STATUSES)[number];

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const forcedLogoutRef = useRef(false);

  const { data: user, isLoading, error } = useGetMe({
    query: {
      queryKey: getGetMeQueryKey(),
      retry: false,
      staleTime: 1000 * 30,
      refetchInterval: 1000 * 60,
      refetchOnWindowFocus: true,
      refetchIntervalInBackground: false,
    }
  });

  const logoutMutation = useLogout({
    mutation: {
      onSuccess: () => {
        queryClient.setQueryData([AUTH_QUERY_KEY], null);
        queryClient.clear();
        setLocation("/login");
      },
      onError: () => {
        queryClient.setQueryData([AUTH_QUERY_KEY], null);
        queryClient.clear();
        setLocation("/login");
      },
    }
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  const actualUser = error ? null : (user || null);

  // ── Route-change: re-verify auth status on every navigation ─────────────
  useEffect(() => {
    if (!location) return;
    queryClient.invalidateQueries({ queryKey: [AUTH_QUERY_KEY] });
  }, [location]);

  // ── Global status gate: force logout if status becomes restricted ────────
  useEffect(() => {
    if (!actualUser) return;
    if (actualUser.role !== "crew") return;

    const status = actualUser.status as string;
    if (RESTRICTED_STATUSES.includes(status as RestrictedStatus)) {
      if (forcedLogoutRef.current) return;
      forcedLogoutRef.current = true;
      queryClient.setQueryData([AUTH_QUERY_KEY], null);
      queryClient.clear();
      setLocation("/login");
    } else {
      forcedLogoutRef.current = false;
    }
  }, [actualUser?.status, actualUser?.id]);

  // ── Handle unauthorised events emitted by the API client ────────────────
  useEffect(() => {
    const handleUnauthorized = () => {
      queryClient.setQueryData([AUTH_QUERY_KEY], null);
      queryClient.clear();
      setLocation("/login");
    };
    window.addEventListener("goteamcrew:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("goteamcrew:unauthorized", handleUnauthorized);
  }, [queryClient, setLocation]);

  return (
    <AuthContext.Provider
      value={{
        user: actualUser,
        isLoading,
        logout: handleLogout,
        isAuthenticated: !!actualUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
