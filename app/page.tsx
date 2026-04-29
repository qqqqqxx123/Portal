"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DFForm } from "@/components/df-form";
import { HistoryView } from "@/components/history-view";
import { LogForm } from "@/components/log-form";
import { getAuthEmail, isAuthenticated, setAuthenticated } from "@/lib/auth";

const LOGOUT_WEBHOOK = process.env.NEXT_PUBLIC_AUTH_LOGOUT_WEBHOOK_URL ?? "";

function getTeamFromEmail(email: string): string {
  const at = email.trim().indexOf("@");
  return at > 0 ? email.trim().slice(0, at) : email.trim();
}

export default function PortalPage() {
  const [mode, setMode] = useState<"df" | "ir" | "history" | null>(null);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated()) {
      router.replace("/login");
    }
  }, [mounted, router]);

  function handleLogout() {
    const email = getAuthEmail();
    if (LOGOUT_WEBHOOK.trim()) {
      fetch(LOGOUT_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: email ?? "" }),
      }).catch(() => {});
    }
    setAuthenticated(false);
    router.replace("/login");
    router.refresh();
  }

  const loading = (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <p className="text-slate-500">Loading...</p>
    </div>
  );

  if (!mounted || !isAuthenticated()) {
    return loading;
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-100">
      {/* Head Bar */}
      <header className="sticky top-0 z-40 flex w-full items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm sm:px-6 lg:px-8">
        <h1 className="text-xl font-semibold text-slate-800 sm:text-2xl">
          VBA Portal
        </h1>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
          <span className="flex min-w-0 flex-shrink items-center gap-2 text-slate-700" title={getAuthEmail() ? `Welcome ${getTeamFromEmail(getAuthEmail()!)}` : undefined}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-orange-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998-5.059 7.5 7.5 0 0 1-14.998 5.059Z" />
              </svg>
            </span>
            <span className="truncate text-sm font-medium sm:text-base" style={{ maxWidth: "min(220px, 40vw)" }}>
              Welcome {getAuthEmail() ? getTeamFromEmail(getAuthEmail()!) : ""}
            </span>
          </span>
          <button
            type="button"
            onClick={() => setMode("history")}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
            title="Repository"
            aria-label="Repository"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            <span className="hidden text-sm font-medium sm:inline">Repository</span>
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
          >
            Logout
          </button>
        </div>
      </header>

      <main className="flex flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
        {mode === null ? (
          /* Centered big icon buttons - 2x size, same for both */
          <div className="flex flex-1 flex-col items-center justify-center gap-6 sm:gap-10">
            <div className="flex flex-wrap items-stretch justify-center gap-8 sm:gap-12">
              <button
                type="button"
                onClick={() => setMode("df")}
                className="flex h-[22rem] w-[22rem] flex-col items-center justify-center gap-6 rounded-2xl border-2 border-slate-200 bg-white shadow-md transition hover:border-orange-400 hover:bg-orange-50 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 sm:h-[26rem] sm:w-[26rem]"
              >
                <span className="flex h-36 w-36 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 sm:h-[10.5rem] sm:w-[10.5rem]">
                  <svg className="h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                  </svg>
                </span>
                <span className="text-center text-2xl font-semibold text-slate-800 sm:text-3xl">
                  Video/Image Analysis
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode("ir")}
                className="flex h-[22rem] w-[22rem] flex-col items-center justify-center gap-6 rounded-2xl border-2 border-slate-200 bg-white shadow-md transition hover:border-orange-400 hover:bg-orange-50 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 sm:h-[26rem] sm:w-[26rem]"
              >
                <span className="flex h-36 w-36 shrink-0 items-center justify-center rounded-2xl bg-orange-100 text-orange-600 sm:h-[10.5rem] sm:w-[10.5rem]">
                  <svg className="h-[4.5rem] w-[4.5rem] sm:h-[5.25rem] sm:w-[5.25rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                  </svg>
                </span>
                <span className="text-center text-2xl font-semibold text-slate-800 sm:text-3xl">
                  .evtx log analysis
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className={`mx-auto w-full ${mode === "history" ? "max-w-6xl" : "max-w-2xl"}`}>
            {/* Back / mode switcher */}
            <div className="mb-6 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode(null)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm transition hover:bg-slate-50"
              >
                ← Back
              </button>
              <span className="text-slate-500">
                {mode === "df" ? "Video/Image Analysis" : mode === "ir" ? ".evtx log analysis" : "Repository"}
              </span>
            </div>

            {mode === "df" && (
              <div className="rounded-xl bg-white p-6 shadow-sm sm:p-8">
                <DFForm />
              </div>
            )}

            {mode === "ir" && (
              <div className="rounded-xl bg-white p-6 shadow-sm sm:p-8">
                <LogForm />
              </div>
            )}

            {mode === "history" && (
              <div className="rounded-xl bg-white p-6 shadow-sm sm:p-8">
                <HistoryView />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
