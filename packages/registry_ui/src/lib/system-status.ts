const REGISTRY_URL =
  process.env.NEXT_PUBLIC_REGISTRY_URL || "http://localhost:8766"
const CHAT_BACKEND =
  process.env.NEXT_PUBLIC_CHAT_BACKEND || "http://localhost:8765"

export interface ServiceStatus {
  key: string
  label: string
  status: "ok" | "degraded" | "unreachable"
  detail?: string
  optional?: boolean
  httpStatus?: number
}

export interface SystemStatus {
  status: "ok" | "degraded"
  services: ServiceStatus[]
}

async function probeService(
  key: string,
  label: string,
  url: string,
  fetchOpts?: RequestInit,
): Promise<ServiceStatus> {
  try {
    const resp = await fetch(url, { ...fetchOpts, signal: AbortSignal.timeout(3000) })
    if (resp.ok) {
      return { key, label, status: "ok" }
    }
    return { key, label, status: "degraded", detail: `HTTP ${resp.status}`, httpStatus: resp.status }
  } catch {
    return { key, label, status: "unreachable", detail: "Connection failed" }
  }
}

export async function getSystemStatus(
  fetchOpts?: RequestInit,
): Promise<SystemStatus> {
  const services = await Promise.all([
    probeService("registry", "Registry API", `${REGISTRY_URL}/livez`, fetchOpts),
    probeService("chat", "Chat Backend", `${CHAT_BACKEND}/livez`, fetchOpts),
  ])

  const overall = services.every((s) => s.status === "ok") ? "ok" : "degraded"
  return { status: overall, services }
}
