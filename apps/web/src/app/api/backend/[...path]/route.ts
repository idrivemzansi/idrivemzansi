import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const api = (process.env.API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const cookieOptions = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge });
function updateCookies(response: NextResponse, data: any) {
  const age = Math.max(60, Number(data.expiresIn ?? 3600));
  response.cookies.set("md_access_token", data.accessToken, cookieOptions(age));
  response.cookies.set("md_id_token", data.idToken, cookieOptions(age));
  if (data.refreshToken) response.cookies.set("md_refresh_token", data.refreshToken, cookieOptions(30 * 24 * 60 * 60));
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const jar = await cookies();
  const originalAccess = jar.get("md_access_token")?.value;
  const refresh = jar.get("md_refresh_token")?.value;
  if (!originalAccess) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const endpoint = api + "/" + path.map(encodeURIComponent).join("/") + new URL(request.url).search;
  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  const send = (token: string) => fetch(endpoint, { method: request.method, headers: { authorization: "Bearer " + token, ...(request.headers.get("content-type") ? { "content-type": request.headers.get("content-type")! } : {}) }, body, cache: "no-store" });
  let upstream = await send(originalAccess);
  let refreshed: any = null;
  if (upstream.status === 401 && refresh) {
    const result = await fetch(api + "/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: refresh }), cache: "no-store" });
    if (result.ok) { refreshed = await result.json(); upstream = await send(refreshed.accessToken); }
  }
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const response = new NextResponse(upstream.status === 204 ? null : await upstream.arrayBuffer(), { status: upstream.status, headers });
  if (refreshed) updateCookies(response, refreshed);
  return response;
}
export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
