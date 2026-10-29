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
function clearSession(response: NextResponse) {
  for (const key of ["md_access_token", "md_id_token", "md_refresh_token"]) response.cookies.set(key, "", { ...cookieOptions(0), expires: new Date(0) });
}
async function exchangeRefreshToken(refresh: string) {
  try {
    const result = await fetch(api + "/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken: refresh }), cache: "no-store" });
    if (result.ok) return { data: await result.json() as any };
    // 400/401 mean Cognito rejected the refresh token itself; anything else is a transient API failure.
    return { rejected: result.status === 400 || result.status === 401 };
  } catch {
    return { unavailable: true };
  }
}

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const jar = await cookies();
  const originalAccess = jar.get("md_access_token")?.value;
  const refresh = jar.get("md_refresh_token")?.value;
  const endpoint = api + "/" + path.map(encodeURIComponent).join("/") + new URL(request.url).search;
  // Public catalogue reads: the API serves these without auth, so anonymous visitors
  // (the marketing homepage) can see instructor profiles and their own prices.
  const isPublicRead = request.method === "GET" && path[0] === "v1" && path[1] === "instructors" && path[2] !== "me" && path.length <= 4;

  // The access cookie lives for expiresIn (1 hour) while the refresh cookie lasts 30 days,
  // so a signed-in user can easily have a refresh token but no access token. Exchange it
  // here instead of rejecting the request.
  let access = originalAccess;
  let refreshed: any = null;
  let rejected = false;
  if (!access && refresh) {
    const outcome = await exchangeRefreshToken(refresh);
    if (outcome.data) { refreshed = outcome.data; access = refreshed.accessToken; }
    else if (outcome.rejected) rejected = true;
    else if (outcome.unavailable && !isPublicRead) return NextResponse.json({ error: "Backend API is unavailable." }, { status: 503 });
  }

  if (!access) {
    if (isPublicRead) {
      const upstream = await fetch(endpoint, { method: "GET", cache: "no-store" });
      const publicHeaders = new Headers();
      const publicType = upstream.headers.get("content-type");
      if (publicType) publicHeaders.set("content-type", publicType);
      return new NextResponse(upstream.status === 204 ? null : await upstream.arrayBuffer(), { status: upstream.status, headers: publicHeaders });
    }
    const response = NextResponse.json({ error: rejected ? "Session expired. Please sign in again." : "Authentication required." }, { status: 401 });
    if (rejected) clearSession(response);
    return response;
  }

  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();
  const send = (token: string) => fetch(endpoint, { method: request.method, headers: { authorization: "Bearer " + token, ...(request.headers.get("content-type") ? { "content-type": request.headers.get("content-type")! } : {}) }, body, cache: "no-store" });
  let upstream = await send(access);
  if (upstream.status === 401 && refresh && !refreshed) {
    const outcome = await exchangeRefreshToken(refresh);
    if (outcome.data) { refreshed = outcome.data; upstream = await send(refreshed.accessToken); }
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
