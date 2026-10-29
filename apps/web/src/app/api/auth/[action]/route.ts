import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

const api = (process.env.API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const options = (maxAge: number) => ({ httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge });
function storeTokens(response: NextResponse, data: any) {
  const age = Math.max(60, Number(data.expiresIn ?? 3600));
  response.cookies.set("md_access_token", data.accessToken, options(age));
  response.cookies.set("md_id_token", data.idToken, options(age));
  if (data.refreshToken) response.cookies.set("md_refresh_token", data.refreshToken, options(30 * 24 * 60 * 60));
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  const jar = await cookies();
  if (action === "logout") {
    const access = jar.get("md_access_token")?.value;
    const refresh = jar.get("md_refresh_token")?.value;
    if (access) await fetch(api + "/v1/auth/logout", { method: "POST", headers: { authorization: "Bearer " + access, "content-type": "application/json" }, body: JSON.stringify({ refreshToken: refresh }) }).catch(() => undefined);
    const response = NextResponse.json({ status: "signed_out" });
    for (const key of ["md_access_token", "md_id_token", "md_refresh_token"]) response.cookies.set(key, "", { ...options(0), expires: new Date(0) });
    return response;
  }
  if (action === "refresh") {
    const refreshToken = jar.get("md_refresh_token")?.value;
    if (!refreshToken) return NextResponse.json({ error: "Session expired. Please sign in again." }, { status: 401 });
    try {
      const upstream = await fetch(api + "/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken }), cache: "no-store" });
      const text = await upstream.text();
      const data = text ? JSON.parse(text) : {};
      if (!upstream.ok) {
        const response = NextResponse.json({ error: data.error ?? "Session expired." }, { status: upstream.status });
        for (const key of ["md_access_token", "md_id_token", "md_refresh_token"]) response.cookies.set(key, "", { ...options(0), expires: new Date(0) });
        return response;
      }
      const response = NextResponse.json({ user: data.user });
      storeTokens(response, data);
      return response;
    } catch {
      return NextResponse.json({ error: "Backend API is unavailable." }, { status: 503 });
    }
  }

  const paths: Record<string, string> = {
    signup: "/v1/auth/signup", confirm: "/v1/auth/confirm", resend: "/v1/auth/resend-code",
    login: "/v1/auth/login", "admin-login": "/v1/auth/admin/login",
  };
  const path = paths[action];
  if (!path) return NextResponse.json({ error: "Unknown authentication action." }, { status: 404 });

  try {
    const upstream = await fetch(api + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: await request.text(),
      cache: "no-store",
    });
    const text = await upstream.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: "Authentication server returned an unreadable response." };
    }
    if (!upstream.ok) return NextResponse.json(data, { status: upstream.status });
    const response = NextResponse.json(action === "login" || action === "admin-login" ? { user: data.user } : data);
    if (action === "login" || action === "admin-login") storeTokens(response, data);
    return response;
  } catch {
    return NextResponse.json(
      { error: "Could not connect to the authentication server on port 4000. Please ensure 'npm run dev:api' is running." },
      { status: 503 }
    );
  }
}
