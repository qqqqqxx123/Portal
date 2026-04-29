"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { getAuthEmail } from "@/lib/auth";

type HistoryTab = "video" | "image" | "log";

const TABS: { id: HistoryTab; label: string }[] = [
  { id: "video", label: "Video Files" },
  { id: "image", label: "Image Files" },
  { id: "log", label: "Log Files" },
];

function getTeamFromEmail(email: string): string {
  const at = email.trim().indexOf("@");
  return at > 0 ? email.trim().slice(0, at) : email.trim();
}

/** Parse date from NocoDB (e.g. "2026-03-16 10:20") or ISO string. Returns null if invalid. */
function parseChatDate(value: string | undefined): Date | null {
  if (value == null || String(value).trim() === "") return null;
  const s = String(value).trim();
  const normalized = s.includes("T") ? s : s.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d)/, "$1T$2");
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface HistorySectionProps {
  category: "video" | "image" | "log";
  team: string;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}

interface RecordItem {
  Id?: string;
  [key: string]: unknown;
}

function HistorySection({ category, team, searchQuery, onSearchChange }: HistorySectionProps) {
  const pageSize = 100;
  const [list, setList] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [category, team]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ category });
    if (team) params.set("team", team);
    params.set("page", String(page));
    params.set("limit", String(pageSize));
    fetch(`/api/history?${params.toString()}`)
      .then(async (res) => {
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.toLowerCase().includes("application/json")) {
          const text = await res.text();
          const preview = text.replace(/\s+/g, " ").slice(0, 120);
          throw new Error(`History API returned non-JSON response (${res.status}). ${preview}`);
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setList(Array.isArray(data?.list) ? data.list : []);
        const pagination = (data?.pagination ?? {}) as {
          page?: unknown;
          total?: unknown;
          totalPages?: unknown;
        };
        const nextPage = Number(pagination.page);
        const nextTotal = Number(pagination.total);
        const nextTotalPages = Number(pagination.totalPages);
        setPage(Number.isFinite(nextPage) && nextPage > 0 ? Math.floor(nextPage) : page);
        setTotal(Number.isFinite(nextTotal) && nextTotal >= 0 ? Math.floor(nextTotal) : 0);
        setTotalPages(Number.isFinite(nextTotalPages) && nextTotalPages > 0 ? Math.floor(nextTotalPages) : 1);
        if (data?.error) setError(data.error);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, team, page, pageSize]);

  function formatBytesToMB(bytes: unknown): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return "—";
    const mb = n / (1024 * 1024);
    return `${mb.toFixed(2)} MB`;
  }

  function formatBytesToKB(bytes: unknown): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return "—";
    const kb = n / 1024;
    return `${kb.toFixed(2)} KB`;
  }

  function formatBytesToKBParts(bytes: unknown): { value: string; unit: string } {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return { value: "—", unit: "" };
    const kb = n / 1024;
    return { value: kb.toFixed(2), unit: "KB" };
  }

  /** Format Image_size from NocoDB: JSON string or object with width/height → "W × H". */
  function formatImageSize(value: unknown): string {
    if (value == null || value === "") return "—";
    let w: number | null = null;
    let h: number | null = null;
    if (typeof value === "object" && "width" in (value as object) && "height" in (value as object)) {
      const o = value as { width: unknown; height: unknown };
      w = Number(o.width);
      h = Number(o.height);
    } else if (typeof value === "string") {
      try {
        const o = JSON.parse(value) as { width?: unknown; height?: unknown };
        w = o.width != null ? Number(o.width) : null;
        h = o.height != null ? Number(o.height) : null;
      } catch {
        return "—";
      }
    }
    if (w != null && h != null && Number.isFinite(w) && Number.isFinite(h)) return `${w} × ${h}`;
    return "—";
  }

  function formatDuration(value: unknown): string {
    if (value == null || value === "") return "—";
    let s: number;
    if (typeof value === "number" && Number.isFinite(value)) {
      s = value;
    } else {
      const str = String(value).trim();
      // NocoDB may store "13s", "1min 30s", "1min", or plain "45"
      const minMatch = str.match(/^(\d+)\s*min(?:\s*(\d+)\s*s?)?$/i);
      const secOnlyMatch = str.match(/^(\d+)\s*s$/i);
      const numOnly = str.match(/^(\d+)$/);
      if (minMatch) {
        const min = parseInt(minMatch[1], 10);
        const sec = minMatch[2] ? parseInt(minMatch[2], 10) : 0;
        s = min * 60 + sec;
      } else if (secOnlyMatch) {
        s = parseInt(secOnlyMatch[1], 10);
      } else if (numOnly) {
        s = parseInt(numOnly[1], 10);
      } else {
        const n = Number(str);
        s = Number.isFinite(n) ? n : NaN;
      }
    }
    if (!Number.isFinite(s) || s < 0) return "—";
    if (s >= 60) {
      const min = Math.floor(s / 60);
      const sec = Math.round(s % 60);
      return sec > 0 ? `${min}min ${sec}s` : `${min}min`;
    }
    return `${Math.round(s)}s`;
  }

  function formatCreatedAt(record: RecordItem): string {
    const v = record["CreatedAt"] ?? record["Created At"] ?? record["submittedAt"];
    if (v == null) return "—";
    const d = new Date(String(v));
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
  }

  function getVal(record: RecordItem, key: string, alt?: string): string {
    const v = record[key] ?? (alt != null ? record[alt] : null);
    return v != null && String(v).trim() !== "" ? String(v).trim() : "—";
  }

  /** Get first video URL from NocoDB attachment column. API may use different key (e.g. column title/id). */
  function getVideoUrl(record: RecordItem): string | null {
    function extractUrl(value: unknown): string | null {
      if (value == null) return null;
      if (typeof value === "string" && (value.startsWith("http") || value.startsWith("/"))) return value;
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (typeof first === "string") return first.startsWith("http") || first.startsWith("/") ? first : null;
        if (typeof first === "object" && first !== null) {
          const u = (first as Record<string, unknown>)["url"] ?? (first as Record<string, unknown>)["path"] ?? (first as Record<string, unknown>)["signedUrl"];
          return typeof u === "string" && u ? u : null;
        }
      }
      if (typeof value === "object" && value !== null) {
        const obj = value as Record<string, unknown>;
        const u = obj["url"] ?? obj["path"] ?? obj["signedUrl"];
        return typeof u === "string" && u ? u : null;
      }
      return null;
    }

    const possibleKeys = [
      "Videofile",
      "videofile",
      "VideoFile",
      "Video file",
      "Videofile_attachment",
      "video_file",
      "Video",
      "video",
    ];
    for (const key of possibleKeys) {
      const url = extractUrl(record[key]);
      if (url) return url;
    }

    // Fallback: scan record for any attachment-like value (array of { url } / { path })
    for (const key of Object.keys(record)) {
      const skip = ["Id", "Title", "Team", "CreatedAt", "report_number", "Report Number", "videoSize", "videoDuration", "reportUrl", "ReportUrl", "Status", "formMode", "Category"];
      if (skip.includes(key)) continue;
      const val = record[key];
      const isAttachmentLike = Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && val[0] !== null && ("url" in (val[0] as object) || "path" in (val[0] as object));
      if (!isAttachmentLike) continue;
      const url = extractUrl(val);
      if (url) return url;
    }
    return null;
  }

  /** Get first image URL from NocoDB attachment column (e.g. Imagefile). Same structure as video attachments. */
  function getImageUrl(record: RecordItem): string | null {
    function extractUrl(value: unknown): string | null {
      if (value == null) return null;
      if (typeof value === "string" && (value.startsWith("http") || value.startsWith("/"))) return value;
      if (Array.isArray(value) && value.length > 0) {
        const first = value[0];
        if (typeof first === "string") return first.startsWith("http") || first.startsWith("/") ? first : null;
        if (typeof first === "object" && first !== null) {
          const u = (first as Record<string, unknown>)["url"] ?? (first as Record<string, unknown>)["path"] ?? (first as Record<string, unknown>)["signedUrl"];
          return typeof u === "string" && u ? u : null;
        }
      }
      if (typeof value === "object" && value !== null) {
        const obj = value as Record<string, unknown>;
        const u = obj["url"] ?? obj["path"] ?? obj["signedUrl"];
        return typeof u === "string" && u ? u : null;
      }
      return null;
    }
    const possibleKeys = ["Imagefile", "imagefile", "ImageFile", "Image file", "Image_attachment", "image_file", "Image", "image"];
    for (const key of possibleKeys) {
      const url = extractUrl(record[key]);
      if (url) return url;
    }
    for (const key of Object.keys(record)) {
      const skip = ["Id", "Title", "Team", "CreatedAt", "report_number", "Report Number", "Image_size", "image_size", "reportUrl", "ReportUrl", "Status", "formMode", "Category"];
      if (skip.includes(key)) continue;
      const val = record[key];
      const isAttachmentLike = Array.isArray(val) && val.length > 0 && typeof val[0] === "object" && val[0] !== null && ("url" in (val[0] as object) || "path" in (val[0] as object));
      if (!isAttachmentLike) continue;
      const url = extractUrl(val);
      if (url) return url;
    }
    return null;
  }

  const isVideo = category === "video";
  const isImage = category === "image";
  const isLog = category === "log";

  /** Filter list by search query (any field value, case-insensitive). Date fields and query are normalized so e.g. "2026/3/10" matches ISO "2026-03-10". */
  const filteredList = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return list;
    const qLower = q.toLowerCase();
    const queryParts: string[] = [qLower];
    const dateLike = /^\d{4}[/-]\d{1,2}[/-]\d{1,2}/.test(q) || /^\d{1,2}[/-]\d{1,2}[/-]\d{4}/.test(q);
    if (dateLike) {
      const d = new Date(q);
      if (!Number.isNaN(d.getTime())) {
        queryParts.push(d.toISOString().slice(0, 10));
        queryParts.push(d.toLocaleDateString().toLowerCase());
      }
    }
    return list.filter((record) => {
      for (const key of Object.keys(record)) {
        const v = record[key];
        if (v == null) continue;
        let s = typeof v === "object" ? JSON.stringify(v) : String(v);
        const dateKeys = ["CreatedAt", "Created At", "submittedAt", "created_at"];
        if (dateKeys.includes(key) || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v))) {
          const d = new Date(String(v));
          if (!Number.isNaN(d.getTime())) {
            s += " " + d.toISOString().slice(0, 10) + " " + d.toLocaleDateString() + " " + d.toLocaleString();
          }
        }
        const searchable = s.toLowerCase();
        if (queryParts.some((part) => searchable.includes(part))) return true;
      }
      return false;
    });
  }, [list, searchQuery]);

  /** For log list only: group records by batch number (Batch_Number / batch_number / report_number). */
  const logRows = useMemo(() => {
    if (!isLog || filteredList.length === 0) return { flat: filteredList, grouped: [] as { batch: string; records: RecordItem[] }[] };
    function getBatch(record: RecordItem): string {
      const v = record["Batch_Number"] ?? record["batch_number"] ?? record["report_number"] ?? record["Report Number"];
      return v != null ? String(v).trim() : "";
    }
    const byBatch = new Map<string, RecordItem[]>();
    for (const record of filteredList) {
      const batch = getBatch(record) || "—";
      if (!byBatch.has(batch)) byBatch.set(batch, []);
      byBatch.get(batch)!.push(record);
    }
    const grouped = Array.from(byBatch.entries()).map(([batch, records]) => ({ batch, records }));
    return { flat: filteredList, grouped };
  }, [isLog, filteredList]);

  const [previewRecord, setPreviewRecord] = useState<RecordItem | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatBatch, setChatBatch] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "bot"; text: string; createdAt?: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatLogsLoading, setChatLogsLoading] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  /** Row IDs (Log_Management_System) for the batch currently open in chat. */
  const chatBatchRowIds = useMemo(() => {
    if (!chatOpen || chatBatch == null || !isLog) return [];
    const group = logRows.grouped.find((g) => g.batch === chatBatch);
    return (group?.records ?? [])
      .map((r) => (r.Id ?? r.id ?? (r as Record<string, unknown>)["RowId"] ?? (r as Record<string, unknown>)["row_id"]) as string | undefined)
      .filter((id): id is string => id != null && String(id).trim() !== "");
  }, [chatOpen, chatBatch, isLog, logRows.grouped]);

  const chatBatchFileNames = useMemo(() => {
    if (!chatOpen || chatBatch == null || !isLog) return [] as string[];
    const group = logRows.grouped.find((g) => g.batch === chatBatch);
    const names = (group?.records ?? [])
      .map((r) => {
        const title = getVal(r, "Title");
        if (title !== "—") return title;
        const report = getVal(r, "report_number", "Report Number");
        if (report !== "—") return report;
        return null;
      })
      .filter((v): v is string => v != null);
    return Array.from(new Set(names));
  }, [chatOpen, chatBatch, isLog, logRows.grouped]);

  /** Load previous chat logs from AI_Chatbot_Logs when chatbot opens for a batch. */
  useEffect(() => {
    if (!chatOpen || chatBatch == null || !isLog) return;
    setChatLogsLoading(true);
    fetch(`/api/chat-logs?batchNumber=${encodeURIComponent(chatBatch)}`)
      .then((res) => res.json())
      .then((data: { list?: { Question?: string; AI_Reply?: string; CreatedAt?: string }[] }) => {
        const list = Array.isArray(data?.list) ? data.list : [];
        const messages: { role: "user" | "bot"; text: string; createdAt?: string }[] = [];
        for (const row of list) {
          const q = row.Question != null ? String(row.Question).trim() : "";
          const a = row.AI_Reply != null ? String(row.AI_Reply).trim() : "";
          const createdAt = row.CreatedAt != null ? String(row.CreatedAt).trim() || undefined : undefined;
          if (q) messages.push({ role: "user", text: q, createdAt });
          if (a) messages.push({ role: "bot", text: a, createdAt });
        }
        setChatMessages(messages);
      })
      .catch(() => setChatMessages((prev) => prev))
      .finally(() => setChatLogsLoading(false));
  }, [chatOpen, chatBatch, isLog]);

  /** Auto-scroll to latest message whenever chat opens or message list changes. */
  useEffect(() => {
    if (!chatOpen) return;
    const el = chatScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [chatOpen, chatMessages.length, chatLogsLoading, chatSending]);

  const previewVideoUrl = previewRecord
    ? ((previewRecord["videoPreviewUrl"] as string | null) ?? getVideoUrl(previewRecord))
    : null;
  const previewImageUrl = previewRecord
    ? ((previewRecord["imagePreviewUrl"] as string | null) ?? getImageUrl(previewRecord))
    : null;
  const previewVideoSrc = previewVideoUrl ? `/api/media?url=${encodeURIComponent(previewVideoUrl)}` : null;
  const previewImageSrc = previewImageUrl ? `/api/media?url=${encodeURIComponent(previewImageUrl)}` : null;
  const rowStartIndex = (page - 1) * pageSize + 1;
  const rowEndIndex = Math.max(rowStartIndex - 1, rowStartIndex + list.length - 1);
  const totalRecords = total > 0 ? total : rowEndIndex;
  const pageOptions = useMemo(() => Array.from({ length: totalPages }, (_, i) => i + 1), [totalPages]);

  return (
    <div className="pt-4">
      {loading && (
        <p className="text-sm text-slate-500">Loading...</p>
      )}
      {error && !loading && (
        <p className="text-sm text-amber-600">{error}</p>
      )}
      {!loading && !error && list.length === 0 && (
        <p className="text-sm text-slate-500">No history yet.</p>
      )}
      {!loading && list.length > 0 && (
        <div className="w-full space-y-3">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-full divide-y divide-slate-200 text-left text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 font-medium text-slate-700">ID</th>
                <th className="px-4 py-3 font-medium text-slate-700">Report number</th>
                {isVideo && (
                  <>
                    <th className="px-4 py-3 font-medium text-slate-700">Video name</th>
                    <th className="px-4 py-3 font-medium text-slate-700">Video size</th>
                    <th className="px-4 py-3 font-medium text-slate-700">Video duration</th>
                  </>
                )}
                {isImage && (
                  <>
                    <th className="px-4 py-3 font-medium text-slate-700">Image name</th>
                    <th className="px-4 py-3 font-medium text-slate-700">Image size</th>
                  </>
                )}
                {isLog && (
                  <>
                    <th className="px-4 py-3 font-medium text-slate-700">Log file name</th>
                    <th className="px-4 py-3 font-medium text-slate-700">Log file size</th>
                  </>
                )}
                {!isLog && <th className="px-4 py-3 font-medium text-slate-700">Upload time</th>}
                <th className="px-4 py-3 text-center font-medium text-slate-700">Download Report</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {isLog && logRows.grouped.length > 0
                ? (() => {
                    const logColSpan = 5;
                    let runningId = rowStartIndex - 1;
                    return logRows.grouped.flatMap(({ batch, records }, groupIndex) => {
                      const batchRecordIds = records
                        .map((r) => r.Id ?? r.id)
                        .filter((id) => id != null)
                        .map((id) => encodeURIComponent(String(id)));
                      const recordIdsQuery = batchRecordIds.length > 0 ? `recordIds=${batchRecordIds.join(",")}` : "";

                      const dataRows = records.map((record) => {
                        runningId += 1;
                        return (
                          <tr key={(record.Id as string) ?? runningId} className="hover:bg-slate-50/50">
                            <td className="px-4 py-3 text-slate-800">{runningId}</td>
                            <td className="px-4 py-3 text-slate-800">{getVal(record, "report_number", "Report Number")}</td>
                            <td className="w-0 max-w-[14rem] px-4 py-3 text-slate-800 whitespace-normal break-words">
                              {getVal(record, "Title", "filename")}
                            </td>
                            <td className="px-4 py-3 text-slate-800">
                              {(() => {
                                const parts = formatBytesToKBParts(record["logSize"] ?? record["LogSize"] ?? record["fileSize"] ?? record["filesize"]);
                                return (
                                  <span className="flex items-baseline justify-end gap-1 tabular-nums">
                                    <span>{parts.value}</span>
                                    <span className="min-w-7 text-left text-slate-500">{parts.unit}</span>
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-4 py-3 text-center align-middle" />
                          </tr>
                        );
                      });
                      const spacer =
                        groupIndex < logRows.grouped.length - 1 ? (
                          <tr key={`spacer-${batch}`}>
                            <td colSpan={logColSpan} className="h-4 bg-slate-50" aria-hidden />
                          </tr>
                        ) : null;
                      return [
                        <tr key={`batch-${batch}`} className="bg-slate-100 font-medium">
                          <td colSpan={logColSpan - 1} className="px-4 py-2 text-slate-700">
                            Upload time: {records[0] ? formatCreatedAt(records[0]) : ""}
                          </td>
                          <td className="px-4 py-2 text-center align-middle">
                            <div className="flex items-center justify-center gap-2">
                              {recordIdsQuery ? (
                                <a
                                  href={`/api/report?category=log&${recordIdsQuery}`}
                                  target="_self"
                                  rel="noopener noreferrer"
                                  title={`Download report (${records.length} log${records.length === 1 ? "" : "s"})`}
                                  className="inline-flex items-center justify-center rounded-lg border border-orange-500 bg-white p-2 text-orange-600 transition hover:bg-orange-50"
                                >
                                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                  </svg>
                                </a>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => {
                                  setChatBatch(batch);
                                  setChatMessages([]);
                                  setChatOpen(true);
                                }}
                                title="AI Chatbot"
                                className="inline-flex items-center justify-center rounded-lg border border-violet-400 bg-white p-2 text-violet-600 transition hover:bg-violet-50"
                                aria-label="AI Chatbot"
                              >
                                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                  <path d="M12 4v2M12 18v2M4 12H2M22 12h-2M6 8H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
                                  <rect x="6" y="10" width="12" height="10" rx="1" />
                                  <circle cx="9.5" cy="14" r="1" fill="currentColor" />
                                  <circle cx="14.5" cy="14" r="1" fill="currentColor" />
                                  <path d="M10 17h4" />
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>,
                        ...dataRows,
                        ...(spacer ? [spacer] : []),
                      ];
                    });
                  })()
                : filteredList.map((record, idx) => (
                    <tr
                      key={(record.Id as string) ?? idx}
                      className={`hover:bg-slate-50/50 ${isVideo || isImage ? "cursor-pointer" : ""}`}
                      onClick={() => (isVideo || isImage) && setPreviewRecord(record)}
                      role={isVideo || isImage ? "button" : undefined}
                      tabIndex={isVideo || isImage ? 0 : undefined}
                      onKeyDown={(e) => (isVideo || isImage) && (e.key === "Enter" || e.key === " ") && setPreviewRecord(record)}
                    >
                      <td className="px-4 py-3 text-slate-800">{rowStartIndex + idx}</td>
                      <td className="px-4 py-3 text-slate-800">{getVal(record, "report_number", "Report Number")}</td>
                      {isVideo && (
                        <>
                          <td className="w-0 max-w-[14rem] px-4 py-3 text-slate-800 whitespace-normal break-words">{getVal(record, "Title")}</td>
                          <td className="px-4 py-3 text-slate-800">{formatBytesToMB(record["videoSize"])}</td>
                          <td className="px-4 py-3 text-slate-800">{formatDuration(record["videoDuration"])}</td>
                        </>
                      )}
                      {isImage && (
                        <>
                          <td className="w-0 max-w-[14rem] px-4 py-3 text-slate-800 whitespace-normal break-words">{getVal(record, "Title")}</td>
                          <td className="px-4 py-3 text-slate-800">{formatImageSize(record["Image_size"] ?? record["image_size"])}</td>
                        </>
                      )}
                      {isLog && (
                        <>
                          <td className="w-0 max-w-[14rem] px-4 py-3 text-slate-800 whitespace-normal break-words">
                            {getVal(record, "Title", "filename")}
                          </td>
                          <td className="px-4 py-3 text-slate-800">
                            {(() => {
                              const parts = formatBytesToKBParts(record["logSize"] ?? record["LogSize"] ?? record["fileSize"] ?? record["filesize"]);
                              return (
                                <span className="flex items-baseline justify-end gap-1 tabular-nums">
                                  <span>{parts.value}</span>
                                  <span className="min-w-7 text-left text-slate-500">{parts.unit}</span>
                                </span>
                              );
                            })()}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-3 text-slate-600">{formatCreatedAt(record)}</td>
                      <td className="px-4 py-3 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                        <a
                          href={
                            isVideo
                              ? `/api/report?category=video&recordId=${encodeURIComponent(String(record.Id ?? record.id ?? ""))}`
                              : isImage
                                ? `/api/report?category=image&recordId=${encodeURIComponent(String(record.Id ?? record.id ?? ""))}`
                                : isLog
                                  ? `/api/report?category=log&recordId=${encodeURIComponent(String(record.Id ?? record.id ?? ""))}`
                                  : ((record["reportUrl"] ?? record["ReportUrl"] ?? "#") as string)
                          }
                          target={isVideo || isImage || isLog ? "_self" : "_blank"}
                          rel="noopener noreferrer"
                          title="Download Report"
                          className="inline-flex items-center justify-center rounded-lg border border-orange-500 bg-white p-2 text-orange-600 transition hover:bg-orange-50"
                        >
                          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
                          </svg>
                        </a>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          </div>
          {filteredList.length === 0 && searchQuery.trim() && (
            <p className="text-sm text-slate-500">No results match your search.</p>
          )}
          {!loading && !error && list.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-sm text-slate-500">
                Showing {rowStartIndex}-{rowEndIndex} of {totalRecords} records
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                  disabled={page <= 1}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Prev
                </button>
                <select
                  value={page}
                  onChange={(e) => setPage(Number(e.target.value))}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700"
                  aria-label="Select page"
                >
                  {pageOptions.map((pageNumber) => (
                    <option key={pageNumber} value={pageNumber}>
                      Page {pageNumber}
                    </option>
                  ))}
                </select>
                <span className="text-sm text-slate-500">/ {totalPages}</span>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={page >= totalPages}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Video / Image preview modal — loads only when opened (on-demand) */}
      {previewRecord != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreviewRecord(null)}
          role="dialog"
          aria-modal="true"
          aria-label={isImage ? "Image preview" : "Video preview"}
        >
          <div
            className="relative max-h-[90vh] w-full max-w-4xl rounded-xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <span className="truncate text-sm font-medium text-slate-800">
                {getVal(previewRecord, "Title")} — {getVal(previewRecord, "report_number", "Report Number")}
              </span>
              <button
                type="button"
                onClick={() => setPreviewRecord(null)}
                className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              {isImage ? (
                previewImageSrc ? (
                  <img
                    src={previewImageSrc}
                    alt={getVal(previewRecord, "Title")}
                    className="max-h-[70vh] w-full rounded-lg object-contain bg-slate-100"
                  />
                ) : (
                  <p className="py-8 text-center text-slate-500">No image attachment for this record.</p>
                )
              ) : previewVideoSrc ? (
                <video
                  src={previewVideoSrc}
                  controls
                  className="max-h-[70vh] w-full rounded-lg bg-black"
                  preload="metadata"
                >
                  Your browser does not support the video tag.
                </video>
              ) : (
                <p className="py-8 text-center text-slate-500">No video attachment for this record.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Chatbot modal — WhatsApp-like */}
      {chatOpen && chatBatch != null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setChatOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="AI Chatbot"
        >
          <div
            className="flex h-[min(90vh,48rem)] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="flex items-center gap-2 text-2xl font-semibold text-slate-800">
                  <span
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-violet-50 text-violet-700"
                    aria-hidden="true"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 4v2M12 18v2M4 12H2M22 12h-2M6 8H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
                      <rect x="6" y="10" width="12" height="10" rx="1" />
                      <circle cx="9.5" cy="14" r="1" fill="currentColor" />
                      <circle cx="14.5" cy="14" r="1" fill="currentColor" />
                      <path d="M10 17h4" />
                    </svg>
                  </span>
                  <span>AI Chatbot</span>
                </h3>
                <div className="mt-2 text-sm text-slate-500">
                  <div>Files:</div>
                  {chatBatchFileNames.length > 0 ? (
                    <ol className="ml-4 list-decimal list-inside">
                      {chatBatchFileNames.map((name) => (
                        <li key={name} className="whitespace-nowrap">
                          <span className="inline-block max-w-full overflow-hidden text-ellipsis align-bottom">
                            {name}
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <div className="ml-4">—</div>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div ref={chatScrollRef} className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3">
              {chatMessages.length === 0 && !chatSending && chatLogsLoading && (
                <p className="text-center text-sm text-slate-500">Loading previous chat...</p>
              )}
              {chatMessages.length === 0 && !chatSending && !chatLogsLoading && (
                <p className="text-center text-sm text-slate-500">Ask a question about the AI analysis result for this batch.</p>
              )}
              {(() => {
                const items: (
                  | { type: "date"; date: string }
                  | { type: "msg"; msg: (typeof chatMessages)[0]; index: number }
                )[] = [];
                let lastDate = "";
                chatMessages.forEach((msg, i) => {
                  const d = parseChatDate(msg.createdAt);
                  const dateStr = d ? d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
                  if (dateStr && dateStr !== lastDate) {
                    lastDate = dateStr;
                    items.push({ type: "date", date: dateStr });
                  }
                  items.push({ type: "msg", msg, index: i });
                });
                return items.map((item, idx) =>
                  item.type === "date" ? (
                    <p key={`date-${idx}-${item.date}`} className="py-2 text-center text-xs text-slate-500">
                      {item.date}
                    </p>
                  ) : (
                    <div
                      key={item.index}
                      className={`flex flex-col ${item.msg.role === "user" ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={
                          item.msg.role === "user"
                            ? "flex max-w-[85%] flex-col rounded-2xl rounded-br-md bg-violet-600 px-3 py-2 text-sm text-white"
                            : "flex max-w-[85%] flex-col rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-sm text-slate-900"
                        }
                      >
                        <span className="break-words">{item.msg.text}</span>
                        {(() => {
                          const d = parseChatDate(item.msg.createdAt);
                          return d ? (
                            <span
                              className={`mt-1 flex justify-end text-[10px] opacity-90 ${item.msg.role === "user" ? "text-violet-200" : "text-slate-500"}`}
                            >
                              {d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false })}
                            </span>
                          ) : null;
                        })()}
                      </div>
                    </div>
                  )
                );
              })()}
              {chatSending && (
                <div className="flex justify-start">
                  <div className="flex max-w-[85%] items-center gap-2 rounded-2xl rounded-bl-md bg-slate-100 px-4 py-3 text-sm text-slate-600">
                    <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.3s]" />
                    <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-slate-500 [animation-delay:-0.15s]" />
                    <span className="inline-block h-2 w-2 animate-bounce rounded-full bg-slate-500" />
                    <span className="sr-only">Loading response...</span>
                  </div>
                </div>
              )}
            </div>
            <form
              className="shrink-0 border-t border-slate-200 p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const q = chatInput.trim();
                if (!q || chatSending) return;
                setChatMessages((prev) => [...prev, { role: "user", text: q, createdAt: new Date().toISOString() }]);
                setChatInput("");
                setChatSending(true);
                try {
                  const chatWebhookUrl = process.env.NEXT_PUBLIC_CHAT_WEBHOOK_URL ?? "";
                  if (!chatWebhookUrl.trim()) {
                    setChatMessages((prev) => [
                      ...prev,
                      { role: "bot", text: "Chat webhook URL missing.", createdAt: new Date().toISOString() },
                    ])
                    return
                  }
                  const res = await fetch(chatWebhookUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      username: team,
                      email: getAuthEmail() ?? "",
                      batchnumber: chatBatch,
                      question: q,
                      rowIds: chatBatchRowIds,
                    }),
                  });
                  const raw = await res.text();
                  let answerText: string | null = null;

                  try {
                    const parsed = JSON.parse(raw) as Record<string, unknown> | unknown[];
                    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                      const obj = parsed as Record<string, unknown>;
                      if (obj.success === false && typeof obj.message === "string") {
                        answerText = obj.message.trim();
                      } else if (typeof obj.answer === "string") {
                        answerText = obj.answer;
                      }
                    } else if (Array.isArray(parsed) && parsed.length > 0) {
                      const first = parsed[0] as Record<string, unknown> | undefined;
                      if (first && typeof first.answer === "string") {
                        answerText = first.answer;
                      }
                    }
                  } catch {
                    // Not JSON; use raw text below if any
                  }

                  if (!answerText && raw.trim()) {
                    answerText = raw.trim();
                  }

if (answerText) {
                      setChatMessages((prev) => [...prev, { role: "bot", text: answerText!, createdAt: new Date().toISOString() }]);
                    }
                } finally {
                  setChatSending(false);
                }
              }}
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type your question..."
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  disabled={chatSending}
                  aria-label="Message"
                />
                <button
                  type="submit"
                  disabled={chatSending || !chatInput.trim()}
                  className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function HistoryView() {
  const [activeTab, setActiveTab] = useState<HistoryTab>("video");
  const [searchQuery, setSearchQuery] = useState("");
  const email = getAuthEmail();
  const team = email ? getTeamFromEmail(email) : "";

  return (
    <div>
      <div className="flex items-center justify-between border-b border-slate-200">
        <nav className="-mb-px flex gap-1" role="tablist">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={
                activeTab === id
                  ? "border-b-2 border-orange-500 px-4 py-3 text-sm font-medium text-orange-600"
                  : "border-b-2 border-transparent px-4 py-3 text-sm font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700"
              }
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="relative shrink-0">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </span>
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search in list..."
            className="w-56 rounded-lg border border-slate-300 py-2 pl-9 pr-4 text-sm outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            aria-label="Search in list"
          />
        </div>
      </div>
      <div role="tabpanel">
        <HistorySection category={activeTab} team={team} searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      </div>
    </div>
  );
}
