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
      // Retry once before treating a failure as definitive — covers transient
      // network blips, PM2 restarts, and nginx upstream momentary unavailability.
      retry: 1,
      retryDelay: 500,
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

  // Only treat the user as logged out when the server explicitly says 401
  // (session expired / never existed). Transient errors (network, 500, etc.)
  // must NOT clear the session — React Query v5 preserves cached `data` even
  // when `error` is set on a background refetch, so we use the cached user.
  const is401 = error != null && (error as any)?.status === 401;
  const actualUser = is401 ? null : (user ?? null);

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
