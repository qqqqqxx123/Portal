"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated, setAuthenticated } from "@/lib/auth";

const REQUEST_OTP_WEBHOOK = process.env.NEXT_PUBLIC_AUTH_REQUEST_OTP_WEBHOOK_URL ?? "";
const VERIFY_OTP_WEBHOOK = process.env.NEXT_PUBLIC_AUTH_VERIFY_OTP_WEBHOOK_URL ?? "";

export default function LoginPage() {
  const [penAddress, setPenAddress] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [otpRequested, setOtpRequested] = useState(false);
  const [mounted, setMounted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (isAuthenticated()) {
      router.replace("/");
    }
  }, [mounted, router]);

  function isValidEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  async function handleRequestOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = penAddress.trim();
    if (!trimmed) {
      setError("Please enter your PEN Address.");
      return;
    }
    if (!isValidEmail(trimmed)) {
      setError("Please enter a valid PEN Address (email format).");
      return;
    }
    setIsRequesting(true);
    try {
      if (!REQUEST_OTP_WEBHOOK.trim()) {
        setError("Request OTP webhook URL missing. Please configure environment variables.");
        return;
      }
      const res = await fetch(REQUEST_OTP_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmed }),
      });
      const text = await res.text();
      let data: { success?: boolean; message?: string; error?: string };
      try {
        data = text ? (JSON.parse(text) as { success?: boolean; message?: string; error?: string }) : {};
      } catch {
        setError(text && text.length < 200 && !text.startsWith("<") ? text : "Could not send OTP. Please try again.");
        return;
      }
      const serverMessage = data.message ?? data.error;
      if (data.success === true) {
        setError(null);
        setOtpRequested(true);
        setOtp("");
      } else {
        setError(serverMessage ?? "Could not send OTP. Please try again.");
      }
    } catch {
      setError("Could not send OTP. Please try again.");
    } finally {
      setIsRequesting(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const otpTrimmed = otp.trim();
    if (!otpTrimmed) {
      setError("Please enter the OTP you received.");
      return;
    }
    if (!/^\d{6}$/.test(otpTrimmed)) {
      setError("OTP must be exactly 6 digits.");
      return;
    }
    setIsVerifying(true);
    try {
      if (!VERIFY_OTP_WEBHOOK.trim()) {
        setError("Verify OTP webhook URL missing. Please configure environment variables.");
        return;
      }
      const res = await fetch(VERIFY_OTP_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: penAddress.trim(),
          otp: otpTrimmed,
        }),
      });
      const text = await res.text();
      let data: { success?: boolean; message?: string; error?: string };
      try {
        data = text ? (JSON.parse(text) as { success?: boolean; message?: string; error?: string }) : {};
      } catch {
        setError(text && text.length < 200 && !text.startsWith("<") ? text : "Verification failed. Please try again.");
        return;
      }
      const serverMessage = data.message ?? data.error;
      if (data.success === true) {
        setAuthenticated(true, penAddress.trim());
        router.replace("/");
        router.refresh();
      } else {
        setError(serverMessage ?? "Verification failed. Please try again.");
      }
    } catch {
      setError("Verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  }

  if (mounted && isAuthenticated()) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-slate-500">Redirecting...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-white px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-orange-200 bg-white px-8 py-10 shadow-lg shadow-orange-100">
          {/* Logo / branding */}
          <div className="mb-8 flex flex-col items-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-xl bg-orange-50">
              <svg
                className="h-9 w-9 text-orange-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-800">
              V.B.A
            </h1>
            <p className="mt-1 text-center text-sm text-slate-500">
              Video Binary Analyst Portal
            </p>
          </div>

          <form
            onSubmit={otpRequested ? handleVerifyOtp : handleRequestOtp}
            className="space-y-6"
          >
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800"
              >
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="pen-address"
                className="block text-sm font-medium text-slate-700"
              >
                PEN Address
              </label>
              <input
                id="pen-address"
                type="email"
                value={penAddress}
                onChange={(e) => setPenAddress(e.target.value)}
                placeholder="your-pen-address@police.gov.hk"
                disabled={otpRequested}
                className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20 disabled:bg-slate-50 disabled:text-slate-600"
                autoComplete="email"
              />
            </div>

            {otpRequested && (
              <div>
                <label
                  htmlFor="otp"
                  className="block text-sm font-medium text-slate-700"
                >
                  OTP
                </label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="Enter 6-digit code"
                  className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/20"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={otpRequested ? isVerifying : isRequesting}
              className="w-full rounded-lg bg-gradient-to-r from-orange-500 to-orange-600 px-4 py-3 font-medium text-white shadow-md transition hover:from-orange-600 hover:to-orange-700 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 disabled:opacity-70"
            >
              {otpRequested
                ? isVerifying
                  ? "Signing in..."
                  : "Sign in"
                : isRequesting
                  ? "Sending..."
                  : "Request OTP"}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          {otpRequested
            ? "Enter the one-time password sent to your PEN Address."
            : "Enter your PEN Address to receive a one-time password."}
        </p>
        {otpRequested && (
          <button
            type="button"
            onClick={() => {
              setOtpRequested(false);
              setOtp("");
              setError(null);
            }}
            className="mt-2 w-full text-center text-sm text-orange-600 hover:text-orange-700 focus:outline-none"
          >
            Use a different address
          </button>
        )}
      </div>
    </div>
  );
}
