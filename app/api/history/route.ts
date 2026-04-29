import { NextRequest, NextResponse } from "next/server";

const NOCODB_BASE = (process.env.NOCODB_BASE_URL ?? "").trim();
const NOCODB_PUBLIC_BASE = (process.env.NOCODB_PUBLIC_BASE_URL ?? "").trim();
/** Optional: extra hostnames to rewrite to public base (comma-separated), e.g. old LAN IP */
const NOCODB_INTERNAL_FILE_HOSTS = (process.env.NOCODB_INTERNAL_FILE_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);
const NOCODB_TOKEN = process.env.NOCODB_API_TOKEN ?? "";
const NOCODB_BASE_ID = process.env.NOCODB_BASE_ID ?? "";
const TABLE_VIDEO = process.env.NOCODB_TABLE_VIDEO ?? process.env.NOCODB_TABLE_ID ?? "";
const TABLE_IMAGE = process.env.NOCODB_TABLE_IMAGE ?? process.env.NOCODB_TABLE_ID ?? "";
const TABLE_LOG = process.env.NOCODB_TABLE_LOG ?? process.env.NOCODB_TABLE_ID ?? "";
const CATEGORY_COLUMN = process.env.NOCODB_CATEGORY_COLUMN ?? "Category";
const TEAM_COLUMN = process.env.NOCODB_TEAM_COLUMN ?? "Team";
/** NocoDB attachment column for video file (e.g. "Videofile"). API may use this title or an id. */
const VIDEO_ATTACHMENT_COLUMN = process.env.NOCODB_VIDEO_ATTACHMENT_COLUMN ?? "Videofile";

type Category = "video" | "image" | "log";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function getTableConfig(category: Category): string {
  if (category === "video") return TABLE_VIDEO;
  if (category === "image") return TABLE_IMAGE;
  return TABLE_LOG;
}

interface NocoTableMeta {
  id: string;
  title?: string;
  table_name?: string;
}

let tablesCache: NocoTableMeta[] | null = null;
let resolvedApiBase: string | null = null;

function normalizeBase(raw: string): string {
  return raw.replace(/\/$/, "");
}

function getCandidateApiBases(): string[] {
  const candidates = [normalizeBase(NOCODB_BASE), normalizeBase(NOCODB_PUBLIC_BASE)].filter(Boolean);
  return Array.from(new Set(candidates));
}

async function fetchFromNoco(path: string, init?: RequestInit): Promise<Response> {
  const candidates = getCandidateApiBases();
  if (candidates.length === 0) throw new Error("NocoDB base URL is not configured");

  const orderedBases = resolvedApiBase
    ? [resolvedApiBase, ...candidates.filter((base) => base !== resolvedApiBase)]
    : candidates;

  const errors: string[] = [];
  for (const base of orderedBases) {
    try {
      const response = await fetch(`${base}${path}`, init);
      resolvedApiBase = base;
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${base} -> ${message}`);
    }
  }
  throw new Error(`Failed to reach NocoDB. Tried: ${errors.join(" | ")}`);
}

async function resolveTableId(tableConfig: string): Promise<string> {
  if (!tableConfig) return "";
  const nameOrId = tableConfig.trim();
  if (!NOCODB_BASE_ID) return nameOrId;

  if (tablesCache === null) {
    try {
      const res = await fetchFromNoco(`/api/v2/meta/bases/${NOCODB_BASE_ID}/tables`, {
        headers: { "xc-token": NOCODB_TOKEN, "Content-Type": "application/json" },
        next: { revalidate: 60 },
      });
      if (!res.ok) return nameOrId;
      const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
      if (!contentType.includes("application/json")) return nameOrId;
      const data = (await res.json()) as { list?: NocoTableMeta[] };
      tablesCache = Array.isArray(data?.list) ? data.list : [];
    } catch {
      return nameOrId;
    }
  }

  const table = tablesCache.find(
    (t) =>
      (t.title && t.title === nameOrId) ||
      (t.table_name && t.table_name === nameOrId) ||
      t.id === nameOrId
  );
  return table?.id ?? nameOrId;
}

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category") as Category | null;
  const team = request.nextUrl.searchParams.get("team") ?? "";
  const pageRaw = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? String(DEFAULT_LIMIT));
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), MAX_LIMIT) : DEFAULT_LIMIT;
  const offset = (page - 1) * limit;
  if (!category || !["video", "image", "log"].includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  if (!NOCODB_BASE || !NOCODB_TOKEN) {
    return NextResponse.json(
      { list: [], message: "NocoDB not configured" },
      { status: 200 }
    );
  }

  const tableConfig = getTableConfig(category);
  if (!tableConfig) {
    return NextResponse.json({ list: [] }, { status: 200 });
  }

  const tableId = await resolveTableId(tableConfig);
  if (!tableId) {
    return NextResponse.json({ list: [] }, { status: 200 });
  }

  /** Prefer signed URLs for browser <video>/<img> (often work without xc-token). */
  function urlFromAttachmentObject(obj: Record<string, unknown>): string | null {
    for (const key of ["signedUrl", "signedPath", "url", "path"] as const) {
      const v = obj[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  }

  function toPublicFileUrl(url: string): string {
    const publicRaw = (NOCODB_PUBLIC_BASE || NOCODB_BASE).replace(/\/$/, "");
    if (!publicRaw) return url;

    let publicOrigin: string;
    try {
      const normalized = publicRaw.startsWith("http") ? publicRaw : `https://${publicRaw}`;
      publicOrigin = new URL(normalized).origin;
    } catch {
      publicOrigin = publicRaw;
    }

    const internalHosts = new Set<string>(["nocodb", ...NOCODB_INTERNAL_FILE_HOSTS]);
    if (NOCODB_BASE) {
      try {
        const baseNorm = NOCODB_BASE.startsWith("http") ? NOCODB_BASE : `http://${NOCODB_BASE}`;
        internalHosts.add(new URL(baseNorm).hostname.toLowerCase());
      } catch {
        /* ignore */
      }
    }

    const isInternalHost = (hostname: string) => internalHosts.has(hostname.toLowerCase());

    if (url.startsWith("/")) {
      return `${publicOrigin}${url}`;
    }
    if (!url.startsWith("http")) {
      return `${publicOrigin}/${url.replace(/^\//, "")}`;
    }

    try {
      const u = new URL(url);
      if (isInternalHost(u.hostname)) {
        return `${publicOrigin}${u.pathname}${u.search}${u.hash}`;
      }
    } catch {
      return url;
    }
    return url;
  }

  function getFirstAttachmentUrl(row: Record<string, unknown>): string | null {
    function fromValue(val: unknown): string | null {
      if (val == null) return null;
      if (typeof val === "string" && (val.startsWith("http") || val.startsWith("/"))) return val;
      if (Array.isArray(val) && val.length > 0) {
        const first = val[0];
        if (typeof first === "string") return first.startsWith("http") || first.startsWith("/") ? first : null;
        if (typeof first === "object" && first !== null) {
          return urlFromAttachmentObject(first as Record<string, unknown>);
        }
      }
      if (typeof val === "object" && val !== null) {
        return urlFromAttachmentObject(val as Record<string, unknown>);
      }
      return null;
    }
    const keys = [VIDEO_ATTACHMENT_COLUMN, "Videofile", "videofile", "VideoFile", "Video file", "video_file"];
    for (const key of keys) {
      const url = fromValue(row[key]);
      if (url) return toPublicFileUrl(url);
    }
    for (const [key, val] of Object.entries(row)) {
      if (["Id", "Title", "Team", "CreatedAt", "report_number", "Report Number", "videoSize", "videoDuration", "reportUrl", "ReportUrl"].includes(key)) continue;
      if (
        Array.isArray(val) &&
        val.length > 0 &&
        typeof val[0] === "object" &&
        val[0] !== null &&
        ("url" in (val[0] as object) ||
          "path" in (val[0] as object) ||
          "signedUrl" in (val[0] as object) ||
          "signedPath" in (val[0] as object))
      ) {
        const url = fromValue(val);
        if (url) return toPublicFileUrl(url);
      }
    }
    return null;
  }

  function getFirstImageAttachmentUrl(row: Record<string, unknown>): string | null {
    function fromValue(val: unknown): string | null {
      if (val == null) return null;
      if (typeof val === "string" && (val.startsWith("http") || val.startsWith("/"))) return val;
      if (Array.isArray(val) && val.length > 0) {
        const first = val[0];
        if (typeof first === "string") return first.startsWith("http") || first.startsWith("/") ? first : null;
        if (typeof first === "object" && first !== null) {
          return urlFromAttachmentObject(first as Record<string, unknown>);
        }
      }
      if (typeof val === "object" && val !== null) {
        return urlFromAttachmentObject(val as Record<string, unknown>);
      }
      return null;
    }
    const keys = ["Imagefile", "imagefile", "ImageFile", "Image file", "Image_attachment", "image_file", "Image", "image"];
    for (const key of keys) {
      const url = fromValue(row[key]);
      if (url) return toPublicFileUrl(url);
    }
    for (const [key, val] of Object.entries(row)) {
      if (["Id", "Title", "Team", "CreatedAt", "report_number", "Report Number", "Image_size", "image_size", "reportUrl", "ReportUrl"].includes(key)) continue;
      if (
        Array.isArray(val) &&
        val.length > 0 &&
        typeof val[0] === "object" &&
        val[0] !== null &&
        ("url" in (val[0] as object) ||
          "path" in (val[0] as object) ||
          "signedUrl" in (val[0] as object) ||
          "signedPath" in (val[0] as object))
      ) {
        const url = fromValue(val);
        if (url) return toPublicFileUrl(url);
      }
    }
    return null;
  }

  const teamTrimmed = team.trim();
  let whereClause: string | null = null;
  if (teamTrimmed) whereClause = `(${TEAM_COLUMN},eq,${teamTrimmed})`;
  else if (TABLE_VIDEO === TABLE_IMAGE && TABLE_IMAGE === TABLE_LOG && CATEGORY_COLUMN) whereClause = `(${CATEGORY_COLUMN},eq,${category})`;

  const url = new URL(`/api/v2/tables/${tableId}/records`, "http://noco.local");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  if (whereClause) url.searchParams.set("where", whereClause);

  try {
    let totalCount = 0;
    try {
      const countUrl = new URL(`/api/v2/tables/${tableId}/records/count`, "http://noco.local");
      if (whereClause) countUrl.searchParams.set("where", whereClause);
      const countRes = await fetchFromNoco(`${countUrl.pathname}${countUrl.search}`, {
        headers: {
          "xc-token": NOCODB_TOKEN,
          "Content-Type": "application/json",
        },
        next: { revalidate: 30 },
      });
      if (countRes.ok) {
        const countContentType = (countRes.headers.get("content-type") ?? "").toLowerCase();
        if (countContentType.includes("application/json")) {
          const countData = (await countRes.json()) as { count?: unknown };
          const parsed = Number(countData?.count);
          if (Number.isFinite(parsed) && parsed >= 0) totalCount = parsed;
        }
      }
    } catch {
      totalCount = 0;
    }

    const res = await fetchFromNoco(`${url.pathname}${url.search}`, {
      headers: {
        "xc-token": NOCODB_TOKEN,
        "Content-Type": "application/json",
      },
      next: { revalidate: 30 },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { list: [], error: text || res.statusText },
        { status: 200 }
      );
    }

    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.includes("application/json")) {
      const text = await res.text();
      const preview = text.replace(/\s+/g, " ").slice(0, 220);
      return NextResponse.json(
        {
          list: [],
          error: `NocoDB returned non-JSON (${res.status}, ${contentType || "unknown"}). ${preview}`,
        },
        { status: 200 }
      );
    }

    const data = (await res.json()) as { list?: unknown[] };
    let list = Array.isArray(data?.list) ? data.list : [];
    if (teamTrimmed && list.length > 0) {
      list = list.filter(
        (row) => typeof row === "object" && row !== null && (row as Record<string, unknown>)[TEAM_COLUMN] === teamTrimmed
      );
    }
    if (category === "video" && list.length > 0) {
      list = list.map((row) => {
        const rec = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
        const url = getFirstAttachmentUrl(rec);
        return { ...rec, videoPreviewUrl: url ?? null };
      });
    }
    if (category === "image" && list.length > 0) {
      list = list.map((row) => {
        const rec = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
        const url = getFirstImageAttachmentUrl(rec);
        return { ...rec, imagePreviewUrl: url ?? null };
      });
    }

    const totalPages = totalCount > 0 ? Math.ceil(totalCount / limit) : 1;
    return NextResponse.json({
      list,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasPrev: page > 1,
        hasNext: page < totalPages,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { list: [], error: err instanceof Error ? err.message : "Failed to fetch" },
      { status: 200 }
    );
  }
}
