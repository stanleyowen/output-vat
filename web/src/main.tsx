import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";
import { Layout } from "./components/Layout";
import { Alert, Spinner } from "./components/ui";
import { AuthProvider, signOut, useAuth } from "./lib/auth";
import { Convert } from "./pages/Convert";
import { History, HistoryDetail } from "./pages/History";
import { Landing } from "./pages/Landing";
import { Templates } from "./pages/Templates";

/** Everything under /app is behind Cloudflare Access; "/" is the public landing page. */
const inApp = window.location.pathname === "/app" || window.location.pathname.startsWith("/app/");

function Gate() {
  const { me, loading, fatal } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="h-6 w-6 text-slate-400" />
      </div>
    );
  }
  if (fatal || !me) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 py-24">
        <Alert kind="error">{fatal?.message ?? "Couldn't load your account."}</Alert>
        <div className="flex gap-2">
          {fatal?.notAllowed ? (
            <button type="button" className="btn-secondary" onClick={signOut}>
              Sign in with a different email
            </button>
          ) : (
            <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <BrowserRouter basename="/app">
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Convert />} />
          <Route path="/history" element={<History />} />
          <Route path="/history/:id" element={<HistoryDetail />} />
          <Route path="/templates" element={<Templates />} />
          <Route path="*" element={<Convert />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {inApp ? (
      <AuthProvider>
        <Gate />
      </AuthProvider>
    ) : (
      <Landing />
    )}
  </StrictMode>,
);
