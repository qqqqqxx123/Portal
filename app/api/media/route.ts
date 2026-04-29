import { NextRequest, NextResponse } from "next/server"

const NOCODB_BASE = (process.env.NOCODB_BASE_URL ?? "").trim()
const NOCODB_PUBLIC_BASE = (process.env.NOCODB_PUBLIC_BASE_URL ?? "").trim()
const NOCODB_TOKEN = (process.env.NOCODB_API_TOKEN ?? "").trim()
const NOCODB_INTERNAL_FILE_HOSTS = (process.env.NOCODB_INTERNAL_FILE_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean)

function parseUrl(raw: string, fallbackProtocol: string): URL | null {
  try {
    if (raw.startsWith("http://") || raw.startsWith("https://")) return new URL(raw)
    return new URL(`${fallbackProtocol}://${raw.replace(/^\/+/, "")}`)
  } catch {
    return null
  }
}

function getAllowedHosts(): Set<string> {
  const hosts = new Set<string>(["nocodb", ...NOCODB_INTERNAL_FILE_HOSTS])
  const parsedBase = parseUrl(NOCODB_BASE, "http")
  const parsedPublicBase = parseUrl(NOCODB_PUBLIC_BASE, "https")
  if (parsedBase) hosts.add(parsedBase.hostname.toLowerCase())
  if (parsedPublicBase) hosts.add(parsedPublicBase.hostname.toLowerCase())
  return hosts
}

function resolveTargetUrl(rawUrl: string): URL | null {
  const parsedPublicBase = parseUrl(NOCODB_PUBLIC_BASE, "https")
  const parsedBase = parseUrl(NOCODB_BASE, "http")

  if (rawUrl.startsWith("/")) {
    if (parsedPublicBase) return new URL(rawUrl, parsedPublicBase.origin)
    if (parsedBase) return new URL(rawUrl, parsedBase.origin)
    return null
  }

  return parseUrl(rawUrl, "https")
}

function copyHeaderIfExists(source: Headers, target: Headers, name: string): void {
  const value = source.get(name)
  if (value) target.set(name, value)
}

function isLikelyHtmlResponse(response: Response): boolean {
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase()
  return contentType.includes("text/html")
}

async function fetchUpstream(url: URL, range: string | null): Promise<Response> {
  const upstreamHeaders = new Headers()
  if (range) upstreamHeaders.set("range", range)
  if (NOCODB_TOKEN) upstreamHeaders.set("xc-token", NOCODB_TOKEN)

  return fetch(url.toString(), {
    method: "GET",
    headers: upstreamHeaders,
    redirect: "follow",
    cache: "no-store",
  })
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url")?.trim()
  if (!rawUrl) return NextResponse.json({ error: "Missing url query parameter" }, { status: 400 })

  const targetUrl = resolveTargetUrl(rawUrl)
  if (!targetUrl) return NextResponse.json({ error: "Invalid media URL" }, { status: 400 })

  const allowedHosts = getAllowedHosts()
  if (!allowedHosts.has(targetUrl.hostname.toLowerCase())) {
    return NextResponse.json({ error: "Host is not allowed for media proxy" }, { status: 403 })
  }

  const range = request.headers.get("range")

  try {
    let upstream = await fetchUpstream(targetUrl, range)

    const parsedBase = parseUrl(NOCODB_BASE, "http")
    const canFallbackToInternal =
      parsedBase &&
      targetUrl.hostname.toLowerCase() !== parsedBase.hostname.toLowerCase() &&
      (isLikelyHtmlResponse(upstream) || !upstream.ok)

    if (canFallbackToInternal) {
      const internalUrl = new URL(`${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`, parsedBase.origin)
      upstream = await fetchUpstream(internalUrl, range)
    }

    const responseHeaders = new Headers()
    copyHeaderIfExists(upstream.headers, responseHeaders, "content-type")
    copyHeaderIfExists(upstream.headers, responseHeaders, "content-length")
    copyHeaderIfExists(upstream.headers, responseHeaders, "accept-ranges")
    copyHeaderIfExists(upstream.headers, responseHeaders, "content-range")
    copyHeaderIfExists(upstream.headers, responseHeaders, "etag")
    copyHeaderIfExists(upstream.headers, responseHeaders, "last-modified")
    copyHeaderIfExists(upstream.headers, responseHeaders, "cache-control")

    // Keep embeddable when requested from other origins or nested contexts.
    responseHeaders.set("Cross-Origin-Resource-Policy", "cross-origin")

    if (isLikelyHtmlResponse(upstream)) {
      const text = await upstream.text()
      const preview = text.replace(/\s+/g, " ").slice(0, 180)
      return NextResponse.json(
        { error: `Media upstream returned HTML (${upstream.status}). ${preview}` },
        { status: 502 }
      )
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stream media" },
      { status: 502 }
    )
  }
}
