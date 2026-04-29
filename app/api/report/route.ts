import { NextRequest, NextResponse } from "next/server";

const NOCODB_BASE = (process.env.NOCODB_BASE_URL ?? "").replace(/\/$/, "");
const NOCODB_TOKEN = process.env.NOCODB_API_TOKEN ?? "";
const NOCODB_BASE_ID = process.env.NOCODB_BASE_ID ?? "";
const TABLE_VIDEO = process.env.NOCODB_TABLE_VIDEO ?? process.env.NOCODB_TABLE_ID ?? "";
const TABLE_IMAGE = process.env.NOCODB_TABLE_IMAGE ?? process.env.NOCODB_TABLE_ID ?? "";
const TABLE_LOG = process.env.NOCODB_TABLE_LOG ?? process.env.NOCODB_TABLE_ID ?? "";
const TEAM_COLUMN = process.env.NOCODB_TEAM_COLUMN ?? "Team";

interface NocoTableMeta {
  id: string;
  title?: string;
  table_name?: string;
}

let tablesCache: NocoTableMeta[] | null = null;

async function resolveTableId(tableConfig: string): Promise<string> {
  if (!tableConfig) return "";
  const nameOrId = tableConfig.trim();
  if (!NOCODB_BASE_ID) return nameOrId;

  if (tablesCache === null) {
    try {
      const res = await fetch(`${NOCODB_BASE}/api/v2/meta/bases/${NOCODB_BASE_ID}/tables`, {
        headers: { "xc-token": NOCODB_TOKEN, "Content-Type": "application/json" },
        next: { revalidate: 60 },
      });
      if (!res.ok) return nameOrId;
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

function safe(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function hkTimeString(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(",", "");
}

function parseArray(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => safe(x).trim()).filter(Boolean);

  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return [];
    try {
      const o = JSON.parse(s) as unknown;
      return Array.isArray(o) ? o.map((x) => safe(x).trim()).filter(Boolean) : [];
    } catch {
      return s
        .split(/\r?\n|,\s*/)
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }

  return [];
}

function bulletList(arr: string[], max: number | null = null): string {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const v of arr) {
    const s = v.trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (max != null && out.length >= max) break;
  }

  if (out.length === 0) return "";
  return out.map((x) => `- ${x}`).join("\n");
}

function bytesToMB(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  return (n / (1024 * 1024)).toFixed(2);
}

function bytesToKB(bytes: unknown): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return "";
  return (n / 1024).toFixed(2);
}

/** Parse Image_size (JSON string or object with width/height) → "W × H" or "". */
function formatImageDimensions(value: unknown): string {
  if (value == null || value === "") return "";
  let w: number | null = null;
  let h: number | null = null;
  if (typeof value === "object" && value !== null && "width" in value && "height" in value) {
    const o = value as { width: unknown; height: unknown };
    w = Number(o.width);
    h = Number(o.height);
  } else if (typeof value === "string") {
    try {
      const o = JSON.parse(value) as { width?: unknown; height?: unknown };
      w = o.width != null ? Number(o.width) : null;
      h = o.height != null ? Number(o.height) : null;
    } catch {
      return "";
    }
  }
  if (w != null && h != null && Number.isFinite(w) && Number.isFinite(h)) return `${w} × ${h}`;
  return "";
}

function parseJsonSafe(v: unknown, fallback: unknown): unknown {
  if (v == null || v === "") return fallback;
  if (typeof v === "object") return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return fallback;
  }
}

/** Match n8n: objects/persons etc. may be string or array → "a, b, c" style. */
function fieldAsReportLine(v: unknown): string {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : String(x)).trim())
      .filter(Boolean)
      .join(", ");
  }
  return String(v);
}

function parseImageSizeFromRecord(j: Record<string, unknown>): { width: string; height: string } {
  const nested = parseJsonSafe(
    j.Image_size ?? j.image_size ?? j.ImageSize ?? j.imageSize,
    {}
  ) as Record<string, unknown>;
  const width =
    j.imageWidth ??
    j.width ??
    nested?.width ??
    "";
  const height =
    j.imageHeight ??
    j.height ??
    nested?.height ??
    "";
  return {
    width: width != null && String(width).trim() !== "" ? String(width) : "",
    height: height != null && String(height).trim() !== "" ? String(height) : "",
  };
}

function parseImagefile(v: unknown): Record<string, unknown>[] {
  const parsed = parseJsonSafe(v, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
}

function firstNonEmpty(...vals: unknown[]): string {
  for (const v of vals) {
    if (v !== null && v !== undefined && String(v).trim() !== "") {
      return String(v);
    }
  }
  return "";
}

/** Image report text aligned with n8n DFIR Image Analysis Report (single or multiple rows). */
function buildImageReportTextMulti(items: Record<string, unknown>[]): string {
  const now = new Date();
  const generatedHK = hkTimeString(now);
  const generatedISO = now.toISOString();
  const first = items[0] ?? {};
  const team = safe(first.Team ?? first[TEAM_COLUMN]);
  const reportNumber = safe(
    first.report_number ?? first.ReportNumber ?? first["Report Number"]
  );

  const lines: string[] = [];
  lines.push("DFIR Image Analysis Report");
  lines.push(`Generated (HK): ${generatedHK}`);
  lines.push(`Generated (UTC): ${generatedISO}`);
  lines.push(`Total images analyzed: ${items.length}`);
  lines.push("=============================================================");
  lines.push("");
  lines.push("Team:");
  lines.push(team || "");
  lines.push("");
  lines.push("Report number:");
  lines.push(reportNumber || "");
  lines.push("");
  lines.push("=============================================================");
  lines.push("");

  for (const j of items) {
    const imagefileArr = parseImagefile(j.Imagefile ?? j.imagefile ?? j.ImageFile);
    const imagefile0 = imagefileArr[0] ?? {};
    const title = safe(
      firstNonEmpty(
        j.Title,
        j.savedName,
        imagefile0.title,
        j.filename,
        j.fileName,
        "Image"
      )
    );

    const summary = safe(
      firstNonEmpty(j.imageSummary, j.Image_summary, j.image_summary)
    );
    const insight = safe(
      firstNonEmpty(j.image_insight, j.Image_insight, j.imageInsight)
    );
    const objects = fieldAsReportLine(j.objectsDetected ?? "");
    const suspicious = fieldAsReportLine(j.suspiciousDetails ?? "");
    const persons = fieldAsReportLine(j.personsInvolved ?? "");
    const cats = fieldAsReportLine(j.contentCategories ?? "");
    const source = safe(
      firstNonEmpty(j.Source, j["Source "], j.source) as string
    );
    const submitDate = safe(
      firstNonEmpty(
        j.SubmitDate,
        j.Submit_date,
        j["Created At"],
        j.CreatedAt,
        j.submittedAt
      ) as string
    );
    const size = parseImageSizeFromRecord(j);
    const w = safe(size.width);
    const h = safe(size.height);

    if (items.length > 1) {
      lines.push(`Image file: ${title}`);
      lines.push("-------------------------------------------------------------");
    } else {
      lines.push("Image file:");
      lines.push(title);
      lines.push("");
    }

    if (source) {
      lines.push(`Source: ${source}`);
      lines.push("");
    }
    if (submitDate) {
      lines.push(`Submit date: ${submitDate}`);
      lines.push("");
    }
    if (w || h) {
      lines.push(`Image size: ${w || "?"} x ${h || "?"}`);
      lines.push("");
    }
    if (objects) {
      lines.push("Objects detected:");
      lines.push(objects);
      lines.push("");
    }
    if (persons) {
      lines.push("Persons involved:");
      lines.push(persons);
      lines.push("");
    }
    if (suspicious) {
      lines.push("Suspicious details:");
      lines.push(suspicious);
      lines.push("");
    }
    if (insight) {
      lines.push("Image insight:");
      lines.push(insight);
      lines.push("");
    }
    lines.push("Image summary:");
    lines.push(summary || "");
    lines.push("");
    if (cats) {
      lines.push("Content categories:");
      lines.push(cats);
      lines.push("");
    }
    lines.push("=============================================================");
    lines.push("");
  }

  return lines.join("\n");
}

/** Filename like n8n: image-analysis-report-DDMMYYYY_HHmm.txt (HK, no seconds). */
function imageAnalysisReportFilename(): string {
  const now = new Date();
  const hkParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const map: Record<string, string> = {};
  hkParts.forEach((p) => {
    map[p.type] = p.value;
  });
  const hkFileTime = `${map.day}${map.month}${map.year}_${map.hour}${map.minute}`;
  return `image-analysis-report-${hkFileTime}.txt`;
}

type ReportCategory = "video" | "image" | "log";

/** Build log report text (single log record). */
function buildLogReportText(record: Record<string, unknown>): string {
  function logSafe(v: unknown): string {
    if (v === null || v === undefined) return ""
    if (Array.isArray(v)) return v.join("\n")
    if (typeof v === "object") return JSON.stringify(v, null, 2)
    return String(v)
  }

  function formatBytes(bytes: unknown): string {
    const n = Number(bytes)
    if (!Number.isFinite(n) || n <= 0) return ""
    const units = ["B", "KB", "MB", "GB", "TB"]
    let size = n
    let idx = 0
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024
      idx++
    }
    const digits = size >= 10 || idx === 0 ? 0 : 1
    return `${size.toFixed(digits)} ${units[idx]}`
  }

  function normalizeSecurityLevel(v: unknown): string {
    const value = logSafe(v).trim().toLowerCase()
    const map: Record<string, string> = {
      critical: "Critical",
      high: "High",
      middle: "Middle",
      medium: "Middle",
      low: "Low",
      informational: "Low",
      unknown: "Low",
      "no security issue": "No security issue",
      none: "No security issue",
      benign: "No security issue",
    }
    return map[value] || logSafe(v) || "No security issue"
  }

  const now = new Date();
  const generatedHK = hkTimeString(now);
  const generatedISO = now.toISOString();

  const team = logSafe(record[TEAM_COLUMN]);
  const reportNumber = logSafe(
    record["report_number"] ?? record["ReportNumber"] ?? record["Report Number"]
  );
  const title = logSafe(
    record["Title"] ??
      record["filename"] ??
      record["fileName"] ??
      record["log_name"] ??
      "Log Entry"
  );
  const securityLevel = normalizeSecurityLevel(record["Security_Level"] ?? record["security_level"] ?? "");
  const logType = logSafe(record["Log_Type"] ?? record["log_type"] ?? "");
  const aiSummary = logSafe(record["AI_Summary"] ?? record["ai_summary"] ?? "");
  const aiAnalysis = logSafe(record["AI_Analysis"] ?? record["ai_analysis"] ?? "");
  const reportParagraph = logSafe(record["Report_Paragraph"] ?? record["report_paragraph"] ?? "");
  const suspiciousFindings = logSafe(record["Suspicious_Findings"] ?? record["suspicious_findings"] ?? "");
  const furtherAction = logSafe(record["Further_Action"] ?? record["further_action"] ?? "");
  const fileSize = formatBytes(record["filesize"]);

  const lines: string[] = [
    "DFIR Log Analysis Report",
    `Generated (HK): ${generatedHK}`,
    `Generated (UTC): ${generatedISO}`,
    "Total log results analyzed: 1",
    "=============================================================",
    "",
    "Team:",
    team,
    "",
    "Report number:",
    reportNumber,
    "",
    "=============================================================",
    "",
    "Log file:",
    title,
    "",
  ];

  if (fileSize) {
    lines.push("File size:")
    lines.push(fileSize)
    lines.push("")
  }

  if (logType) {
    lines.push("Log type:")
    lines.push(logType)
    lines.push("")
  }

  if (securityLevel) {
    lines.push("Security level:")
    lines.push(securityLevel)
    lines.push("")
  }

  if (suspiciousFindings) {
    lines.push("Suspicious findings:")
    lines.push(suspiciousFindings)
    lines.push("")
  }

  if (aiSummary) {
    lines.push("AI summary:")
    lines.push(aiSummary)
    lines.push("")
  }

  if (aiAnalysis) {
    lines.push("AI analysis:")
    lines.push(aiAnalysis)
    lines.push("")
  }

  if (reportParagraph) {
    lines.push("Report paragraph:")
    lines.push(reportParagraph)
    lines.push("")
  }

  if (furtherAction) {
    lines.push("Further action:")
    lines.push(furtherAction)
    lines.push("")
  }

  lines.push("=============================================================", "");

  return lines.join("\n");
}

/** Build log report for multiple records (one report per batch). */
function buildLogReportTextMulti(records: Record<string, unknown>[]): string {
  if (records.length === 0) return "";

  function logSafe(v: unknown): string {
    if (v === null || v === undefined) return "";
    if (Array.isArray(v)) return v.join("\n");
    if (typeof v === "object") return JSON.stringify(v, null, 2);
    return String(v);
  }

  function formatBytes(bytes: unknown): string {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = n;
    let idx = 0;
    while (size >= 1024 && idx < units.length - 1) {
      size /= 1024;
      idx++;
    }
    const digits = size >= 10 || idx === 0 ? 0 : 1;
    return `${size.toFixed(digits)} ${units[idx]}`;
  }

  function normalizeSecurityLevel(v: unknown): string {
    const value = logSafe(v).trim().toLowerCase();
    const map: Record<string, string> = {
      critical: "Critical",
      high: "High",
      middle: "Middle",
      medium: "Middle",
      low: "Low",
      informational: "Low",
      unknown: "Low",
      "no security issue": "No security issue",
      none: "No security issue",
      benign: "No security issue",
    };
    return map[value] || logSafe(v) || "No security issue";
  }

  function getStr(record: Record<string, unknown>, ...keys: string[]): string {
    for (const k of keys) {
      const v = record[k];
      if (v !== null && v !== undefined && String(v).trim() !== "") return logSafe(v);
    }
    return "";
  }

  function blockForRecord(record: Record<string, unknown>): string[] {
    const title = logSafe(
      record["Title"] ??
        record["filename"] ??
        record["fileName"] ??
        record["log_name"] ??
        "Log Entry"
    );
    const securityLevel = normalizeSecurityLevel(
      getStr(record, "Security_Level", "security_level", "Security Level") || ""
    );
    const logType = getStr(record, "Log_Type", "log_type", "Log Type");
    const aiSummary = getStr(record, "AI_Summary", "ai_summary", "AI Summary");
    const aiAnalysis = getStr(record, "AI_Analysis", "ai_analysis", "AI Analysis");
    const reportParagraph = getStr(record, "Report_Paragraph", "report_paragraph", "Report Paragraph");
    const suspiciousFindings = getStr(record, "Suspicious_Findings", "suspicious_findings", "Suspicious Findings");
    const furtherAction = getStr(record, "Further_Action", "further_action", "Further Action");
    const fileSize = formatBytes(record["filesize"]);

    const lines: string[] = ["Log file:", title, ""];
    lines.push("File size:", fileSize || "—", "");
    lines.push("Log type:", logType || "—", "");
    lines.push("Security level:", securityLevel, "");
    lines.push("Suspicious findings:", suspiciousFindings || "—", "");
    lines.push("AI summary:", aiSummary || "—", "");
    lines.push("AI analysis:", aiAnalysis || "—", "");
    lines.push("Report paragraph:", reportParagraph || "—", "");
    lines.push("Further action:", furtherAction || "—", "");
    lines.push("=============================================================", "");
    return lines;
  }

  const now = new Date();
  const generatedHK = hkTimeString(now);
  const generatedISO = now.toISOString();
  const first = records[0]!;
  const team = logSafe(first[TEAM_COLUMN]);
  const reportNumber = logSafe(
    first["report_number"] ?? first["ReportNumber"] ?? first["Report Number"]
  );

  const lines: string[] = [
    "DFIR Log Analysis Report",
    `Generated (HK): ${generatedHK}`,
    `Generated (UTC): ${generatedISO}`,
    `Total log results analyzed: ${records.length}`,
    "=============================================================",
    "",
    "Team:",
    team,
    "",
    "Report number:",
    reportNumber,
    "",
    "=============================================================",
    "",
  ];

  for (const record of records) {
    lines.push(...blockForRecord(record));
  }

  return lines.join("\n");
}

function buildReportText(record: Record<string, unknown>, category: ReportCategory): string {
  if (category === "image") return buildImageReportTextMulti([record]);
  if (category === "log") return buildLogReportText(record);

  const now = new Date();
  const generatedHK = hkTimeString(now);
  const generatedISO = now.toISOString();

  const team = safe(record[TEAM_COLUMN]);
  const reportNumber = safe(
    record["report_number"] ?? record["ReportNumber"] ?? record["Report Number"]
  );

  const title = safe(record["Title"] ?? record["filename"] ?? record["fileName"] ?? "(untitled)");
  const createdAt = safe(record["created_at"] ?? record["CreatedAt"] ?? record["Created At"]);
  const verbatimContent = safe(record["verbatimContent"]);
  const personsInvolved = safe(record["personsInvolved"]);
  const videoSummary = safe(record["video_summary"]);

  const objectsArr = parseArray(record["objectsDetected"]);
  const suspiciousArr = parseArray(record["suspiciousDetails"]);
  const insightArr = parseArray(record["video_insight"]);
  const catsArr = parseArray(record["contentCategories"]);

  const videoSizeMB = bytesToMB(record["videoSize"]);
  const videoDuration = safe(record["videoDuration"] ?? record["videoDurationSec"]);
  const videoPath = safe(record["videoPath"]);

  const lines: string[] = [
    "DFIR Video Analysis Report",
    `Generated (HK): ${generatedHK}`,
    `Generated (UTC): ${generatedISO}`,
    "Total items: 1",
    "=============================================================",
    "",
    "Team:",
    team,
    "",
    "Report number:",
    reportNumber,
    "",
    "=============================================================",
    "",
    `Video: ${title}`,
  ];

  if (createdAt) lines.push(`Created at: ${createdAt}`);
  if (videoPath) lines.push(`Video path: ${videoPath}`);
  if (videoDuration) lines.push(`Video duration: ${videoDuration}`);
  if (videoSizeMB) lines.push(`Video size (MB): ${videoSizeMB}`);
  lines.push("=============================================================", "");

  lines.push("Transcript:", verbatimContent || "[NO AUDIO / NO TRANSCRIPT PROVIDED]", "");
  lines.push("Persons involved:", personsInvolved || "No persons detected in video", "");
  lines.push(
    "Objects detected:",
    bulletList(objectsArr, 50) || "- No objects detected in video",
    ""
  );
  lines.push(
    "Suspicious details:",
    bulletList(suspiciousArr, 50) || "- No suspicious details detected in video",
    ""
  );
  lines.push(
    "Video insight:",
    bulletList(insightArr, 50) || "- No additional video insight available",
    ""
  );
  lines.push(
    "Content categories:",
    bulletList(catsArr, 50) || "- No content category identified",
    ""
  );
  lines.push("Video summary:", videoSummary || "", "");
  lines.push("=============================================================", "");

  return lines.join("\n");
}

function reportFilename(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map: Record<string, string> = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  const hkFileTime = `${map.day}${map.month}${map.year}_${map.hour}${map.minute}${map.second}`;
  return `video-analysis-report-${hkFileTime}.txt`;
}

function reportFilenameForCategory(category: ReportCategory): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map: Record<string, string> = {};
  parts.forEach((p) => {
    map[p.type] = p.value;
  });
  const hkFileTime = `${map.day}${map.month}${map.year}_${map.hour}${map.minute}${map.second}`;
  if (category === "image") return imageAnalysisReportFilename();
  const prefix = category === "log" ? "log-analysis-report" : "video-analysis-report";
  return `${prefix}-${hkFileTime}.txt`;
}

export async function GET(request: NextRequest) {
  const category = request.nextUrl.searchParams.get("category");
  const recordId = request.nextUrl.searchParams.get("recordId");
  const recordIdsParam = request.nextUrl.searchParams.get("recordIds");

  const isLogMulti = category === "log" && recordIdsParam?.trim();
  const isImageMulti = category === "image" && recordIdsParam?.trim();
  const hasSingleId = recordId?.trim();

  if (category !== "video" && category !== "image" && category !== "log") {
    return NextResponse.json(
      { error: "Invalid category (use category=video, image, or log)" },
      { status: 400 }
    );
  }
  if (!isLogMulti && !isImageMulti && !hasSingleId) {
    return NextResponse.json(
      {
        error:
          "Missing recordId, or use recordIds (comma-separated) for batch image or log report",
      },
      { status: 400 }
    );
  }

  if (!NOCODB_BASE || !NOCODB_TOKEN) {
    return NextResponse.json(
      { error: "NocoDB not configured" },
      { status: 503 }
    );
  }

  const tableConfig =
    category === "image" ? TABLE_IMAGE : category === "log" ? TABLE_LOG : TABLE_VIDEO;
  const tableId = await resolveTableId(tableConfig);
  const tableLabel = category === "image" ? "Image" : category === "log" ? "Log" : "Video";
  if (!tableId) {
    return NextResponse.json(
      { error: `${tableLabel} table not found` },
      { status: 404 }
    );
  }

  async function fetchRecord(idKey: string, idValue: string): Promise<Record<string, unknown> | null> {
    const url = new URL(`${NOCODB_BASE}/api/v2/tables/${tableId}/records`);
    url.searchParams.set("where", `(${idKey},eq,${idValue})`);
    url.searchParams.set("limit", "1");
    const res = await fetch(url.toString(), {
      headers: {
        "xc-token": NOCODB_TOKEN,
        "Content-Type": "application/json",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { list?: Record<string, unknown>[] };
    const list = Array.isArray(data?.list) ? data.list : [];
    return list[0] ?? null;
  }

  try {
    if (isLogMulti) {
      const ids = recordIdsParam!.trim().split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) {
        return NextResponse.json(
          { error: "recordIds must contain at least one id" },
          { status: 400 }
        );
      }
      const records: Record<string, unknown>[] = [];
      for (const id of ids) {
        let rec = await fetchRecord("Id", id);
        if (!rec) rec = await fetchRecord("id", id);
        if (rec && typeof rec === "object") records.push(rec);
      }
      if (records.length === 0) {
        return NextResponse.json(
          { error: "No records found for the given recordIds" },
          { status: 404 }
        );
      }
      const reportText = buildLogReportTextMulti(records);
      const filename = reportFilenameForCategory("log");

      return new NextResponse(reportText, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    if (isImageMulti) {
      const ids = recordIdsParam!.trim().split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length === 0) {
        return NextResponse.json(
          { error: "recordIds must contain at least one id" },
          { status: 400 }
        );
      }
      const records: Record<string, unknown>[] = [];
      for (const id of ids) {
        let rec = await fetchRecord("Id", id);
        if (!rec) rec = await fetchRecord("id", id);
        if (rec && typeof rec === "object") records.push(rec);
      }
      if (records.length === 0) {
        return NextResponse.json(
          { error: "No image records found for the given recordIds" },
          { status: 404 }
        );
      }
      const reportText = buildImageReportTextMulti(records);
      const filename = imageAnalysisReportFilename();
      return new NextResponse(reportText, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const idValue = recordId!.trim();
    let record = await fetchRecord("Id", idValue);
    if (!record) record = await fetchRecord("id", idValue);

    if (!record || typeof record !== "object") {
      return NextResponse.json(
        { error: "Record not found" },
        { status: 404 }
      );
    }

    const reportText = buildReportText(record, category as ReportCategory);
    const filename = reportFilenameForCategory(category as ReportCategory);

    return new NextResponse(reportText, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate report" },
      { status: 500 }
    );
  }
}
