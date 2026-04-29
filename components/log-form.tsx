"use client";

import { useState, useRef } from "react";
import { getAuthEmail } from "@/lib/auth";

const MAX_FILES = 10;
const REPORT_NUMBER_REGEX = /^[A-Z]*[0-9]{8}$/;

const WEBHOOK_URL = process.env.NEXT_PUBLIC_LOG_WEBHOOK_URL ?? "";

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function getTeamFromEmail(email: string): string {
  const at = email.trim().indexOf("@");
  return at > 0 ? email.trim().slice(0, at) : email.trim();
}

export function LogForm() {
  const [reportNumber, setReportNumber] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [totalProcessed, setTotalProcessed] = useState<number>(0);
  const [successCount, setSuccessCount] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    if (selected.length > MAX_FILES) {
      setError(`Maximum ${MAX_FILES} files allowed. Only the first ${MAX_FILES} were selected.`);
      setFiles(selected.slice(0, MAX_FILES));
    } else {
      setError(null);
      setFiles(selected);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const reportTrimmed = reportNumber.trim();
    if (!reportTrimmed) {
      setError("Please enter a Report Number.");
      return;
    }
    if (!REPORT_NUMBER_REGEX.test(reportTrimmed)) {
      setError("Please enter a correct Report Number: capital letters followed by exactly 8 digits.");
      return;
    }
    if (files.length === 0) {
      setError("Please select at least one log or EVTX file to upload.");
      return;
    }
    const loginEmail = getAuthEmail()?.trim() ?? "";
    if (!loginEmail) {
      setError("Session missing. Please log in again.");
      return;
    }
    if (!isValidEmail(loginEmail)) {
      setError("Invalid login email. Please log in again.");
      return;
    }

    setIsSubmitting(true);
    const teamName = getTeamFromEmail(loginEmail);

    if (!WEBHOOK_URL.trim()) {
      setIsSubmitting(false)
      setError("Webhook URL missing (NEXT_PUBLIC_LOG_WEBHOOK_URL). Please configure .env.")
      return
    }

    const payload = [
      {
        Team: teamName,
        "Report Number": reportTrimmed,
        "Log files to be uploaded": files.map((f) => ({
          filename: f.name,
          mimetype: f.type || "text/plain",
          size: f.size,
        })),
        "Source ": "",
        "Media URL ": "",
        "Recipient Email Address": loginEmail,
        submittedAt: new Date().toISOString(),
        formMode: "ir",
      },
    ];

    const RETRY_DELAY_MS = 5000;

    async function trySend(): Promise<void> {
      const formData = new FormData();
      formData.append("payload", JSON.stringify(payload));
      files.forEach((f) => formData.append("Log files to be uploaded", f));

      try {
        const res = await fetch(WEBHOOK_URL, {
          method: "POST",
          body: formData,
        });
        const text = await res.text();
        type ResultItem = {
          success?: boolean;
          message?: string;
          totalProcessed?: number;
          successCount?: number;
        };
        let data: ResultItem | ResultItem[];
        try {
          data = text ? (JSON.parse(text) as ResultItem | ResultItem[]) : {};
        } catch {
          if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
          throw new Error("Invalid response from server.");
        }
        const item = Array.isArray(data) ? data[0] : data;
        if (item?.success !== true) {
          setIsSubmitting(false);
          setSuccess(false);
          setError((item && "message" in item ? item.message : null) ?? "Analysis request failed.");
          return;
        }
        setIsSubmitting(false);
        setError(null);
        setSuccessMessage(typeof item.message === "string" ? item.message : "Log Analysis Success");
        setTotalProcessed(typeof item.totalProcessed === "number" ? item.totalProcessed : 0);
        setSuccessCount(typeof item.successCount === "number" ? item.successCount : 0);
        setSuccess(true);
        setReportNumber("");
        setFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
      } catch {
        // Network or fetch error (including timeouts). Wait and retry, keeping the spinner visible.
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        return trySend();
      }
    }

    void trySend();
  }

  return (
    <>
      {isSubmitting && (
        <div
          className="fixed top-20 right-4 z-50 flex items-center gap-2 rounded-lg border border-orange-200 bg-white px-4 py-3 shadow-lg"
          role="status"
          aria-live="polite"
        >
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          <span className="text-sm font-medium text-slate-700">
            Processing...
          </span>
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-9">
        <div>
          <h2 className="text-2xl font-semibold text-slate-800 sm:text-3xl">
            Upload .evtx logs
          </h2>
          <p className="mt-1.5 text-base text-slate-500 sm:text-lg">
            Upload Relevant Log Files for Analysis
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-base text-red-800"
          >
            {error}
          </div>
        )}
        {success && (
          <div
            role="status"
            className="rounded-xl border border-green-200 bg-green-50 px-5 py-4 text-base text-green-800"
          >
            <p className="font-medium">{successMessage}</p>
            {(totalProcessed > 0 || successCount > 0) && (
              <p className="mt-1">
                {successCount} of {totalProcessed} processed successfully.
              </p>
            )}
            <p className="mt-1">The analysis report will be sent to your email.</p>
          </div>
        )}

        <div>
          <label htmlFor="reportNumber" className="block text-base font-medium text-slate-700 sm:text-lg">
            Report Number <span className="text-red-500">*</span>
          </label>
          <input
            id="reportNumber"
            type="text"
            value={reportNumber}
            onChange={(e) => {
              const v = e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 30);
              setReportNumber(v);
            }}
            maxLength={30}
            placeholder="e.g. ABDDIV26000001"
            className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-500 sm:text-lg"
          />
        </div>

        <div>
          <label htmlFor="logs" className="block text-base font-medium text-slate-700 sm:text-lg">
            .evtx files to be uploaded <span className="text-red-500">*</span>
          </label>
          <input
            ref={fileInputRef}
            id="logs"
            type="file"
            accept=".evtx,application/x-evtx,application/octet-stream"
            multiple
            onChange={handleFileChange}
            className="mt-1.5 block w-full text-base text-slate-600 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-5 file:py-3 file:text-base file:text-slate-700 file:shadow-sm hover:file:bg-slate-200"
          />
          <p className="mt-1.5 text-sm text-slate-500 sm:text-base">
            Maximum {MAX_FILES} files (.evtx). Each file maximum size: 200MB. Selected: {files.length} file(s).
          </p>
          {files.length > 0 && (
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-slate-600 sm:text-base">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="break-words">
                  {f.name}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="pt-3">
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-lg bg-rose-500 px-5 py-4 text-lg font-medium text-white shadow-sm transition hover:bg-rose-600 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2 disabled:opacity-60 disabled:pointer-events-none sm:text-xl"
          >
            {isSubmitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </form>
    </>
  );
}
