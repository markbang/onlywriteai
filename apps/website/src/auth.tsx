import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext } from "react";
import { getAuthStatus, logout, type AuthStatus } from "./api/documents.ts";

type AuthContextValue = AuthStatus & {
  isLoading: boolean;
  signIn(): void;
  signOut(): void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const auth = useQuery({
    queryKey: ["auth"],
    queryFn: () => getAuthStatus(),
    retry: false,
  });
  const signOut = useMutation({
    mutationFn: () => logout(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      queryClient.clear();
    },
  });

  const status = auth.data ?? { enabled: false, user: null };
  const value: AuthContextValue = {
    ...status,
    isLoading: auth.isLoading,
    signIn() {
      window.location.assign("/api/auth/login");
    },
    signOut() {
      signOut.mutate();
    },
  };

  if (auth.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-secondary text-sm text-muted">
        Loading session...
      </div>
    );
  }

  if (auth.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4">
        <section className="w-full max-w-sm border border-border bg-surface p-5">
          <h1 className="text-lg font-semibold text-foreground">OnlyWrite</h1>
          <p className="mt-2 text-sm text-danger">Could not load authentication status.</p>
        </section>
      </div>
    );
  }

  if (status.enabled && !status.user) {
    return (
      <AuthContext.Provider value={value}>
        <div className="flex min-h-screen items-center justify-center bg-surface-secondary px-4">
          <section className="w-full max-w-sm border border-border bg-surface p-5">
            <h1 className="text-lg font-semibold text-foreground">OnlyWrite</h1>
            <p className="mt-2 text-sm text-muted">Sign in to continue writing.</p>
            <button
              className="mt-5 inline-flex h-10 items-center gap-2 rounded bg-accent px-4 text-sm font-medium text-accent-foreground hover:bg-accent"
              type="button"
              onClick={() => value.signIn()}
            >
              <span className="i-lucide-log-in h-4 w-4" aria-hidden="true" />
              Sign in
            </button>
          </section>
        </div>
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return value;
}
