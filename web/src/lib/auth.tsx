import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Me } from "./api";

interface AuthState {
  me: Me | null;
  loading: boolean;
  /** Set when the signed-in Cloudflare account isn't allowed, or the API is unreachable. */
  fatal: { message: string; notAllowed: boolean } | null;
  signOut: () => void;
}

const Ctx = createContext<AuthState>(null as unknown as AuthState);

/** Cloudflare Access logout for this hostname; ends the Access session (and so the app session). */
export const signOut = () => {
  window.location.href = "/cdn-cgi/access/logout";
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState<AuthState["fatal"]>(null);

  const load = useCallback(async () => {
    try {
      setMe(await api.me());
    } catch (e) {
      const notAllowed = e instanceof ApiError && e.code === "NOT_ALLOWED";
      setFatal({ message: e instanceof ApiError ? e.message : "Couldn't load your account.", notAllowed });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return <Ctx.Provider value={{ me, loading, fatal, signOut }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
