import { NextRequest, NextResponse } from "next/server";

const NOCODB_BASE = (process.env.NOCODB_BASE_URL ?? "").replace(/\/$/, "");
const NOCODB_TOKEN = process.env.NOCODB_API_TOKEN ?? "";
const NOCODB_BASE_ID = process.env.NOCODB_BASE_ID ?? "";
const TABLE_AI_CHATBOT_LOGS = process.env.NOCODB_TABLE_AI_CHATBOT_LOGS ?? "";

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

export interface ChatLogRow {
  Question?: string;
  AI_Reply?: string;
  CreatedAt?: string;
  Batch_Number?: string;
  [key: string]: unknown;
}

/** GET /api/chat-logs?batchNumber=xxx — returns previous Q&A for that batch. Table name from NOCODB_TABLE_AI_CHATBOT_LOGS. */
export async function GET(request: NextRequest) {
  const batchNumber = request.nextUrl.searchParams.get("batchNumber") ?? "";

  if (!batchNumber.trim()) {
    return NextResponse.json({ list: [] }, { status: 200 });
  }

  if (!NOCODB_BASE || !NOCODB_TOKEN) {
    return NextResponse.json({ list: [], message: "NocoDB not configured" }, { status: 200 });
  }

  if (!TABLE_AI_CHATBOT_LOGS.trim()) {
    return NextResponse.json({ list: [], message: "NOCODB_TABLE_AI_CHATBOT_LOGS not set" }, { status: 200 });
  }

  const tableId = await resolveTableId(TABLE_AI_CHATBOT_LOGS);
  if (!tableId) {
    return NextResponse.json({ list: [] }, { status: 200 });
  }

  const url = new URL(`${NOCODB_BASE}/api/v2/tables/${tableId}/records`);
  url.searchParams.set("limit", "500");
  url.searchParams.set("where", `(Batch_Number,eq,${batchNumber.trim()})`);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "xc-token": NOCODB_TOKEN,
        "Content-Type": "application/json",
      },
      next: { revalidate: 0 },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { list: [], error: text || res.statusText },
        { status: 200 }
      );
    }

    const data = (await res.json()) as { list?: ChatLogRow[] };
    let list = Array.isArray(data?.list) ? data.list : [];

    list = list
      .filter((row) => row && typeof row === "object")
      .sort((a, b) => {
        const at = a.CreatedAt != null ? new Date(String(a.CreatedAt)).getTime() : 0;
        const bt = b.CreatedAt != null ? new Date(String(b.CreatedAt)).getTime() : 0;
        return at - bt;
      });

    return NextResponse.json({ list });
  } catch (err) {
    return NextResponse.json(
      { list: [], error: err instanceof Error ? err.message : "Failed to fetch" },
      { status: 200 }
    );
  }
}
