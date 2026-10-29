import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CognitoJwtVerifier } from "aws-jwt-verify";

type AppRole = "learner" | "instructor" | "admin";
type Session = { sub: string; email?: string; role: AppRole; accessToken: string; idToken: string };
const api = (process.env.API_BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
let verifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;
let accessVerifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;

function roleFor(claims: Record<string, unknown>): AppRole | null {
  const groups = Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] as string[] : [];
  if (groups.includes("admin")) return "admin";
  if (groups.includes("instructor")) return "instructor";
  if (groups.includes("learner")) return "learner";
  return null;
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  let accessToken = jar.get("md_access_token")?.value;
  let idToken = jar.get("md_id_token")?.value;
  const refreshToken = jar.get("md_refresh_token")?.value;
  const poolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!poolId || !clientId) return null;
  verifier ??= CognitoJwtVerifier.create({ userPoolId: poolId, clientId, tokenUse: "id" });
  accessVerifier ??= CognitoJwtVerifier.create({ userPoolId: poolId, clientId, tokenUse: "access" });
  let claims: Record<string, unknown>;
  try {
    if (!idToken || !accessToken) throw new Error("No session tokens");
    claims = await verifier.verify(idToken) as Record<string, unknown>;
    await accessVerifier.verify(accessToken);
  } catch {
    if (!refreshToken) return null;
    try {
      const refreshed = await fetch(api + "/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken }), cache: "no-store" });
      if (!refreshed.ok) return null;
      const data = await refreshed.json();
      accessToken = data.accessToken; idToken = data.idToken;
      if (typeof idToken !== "string" || typeof accessToken !== "string") return null;
      claims = await verifier.verify(idToken) as Record<string, unknown>;
      await accessVerifier.verify(accessToken);
    } catch { return null; }
  }
  const role = roleFor(claims);
  if (!role || !claims.sub || !accessToken || !idToken) return null;
  return { sub: String(claims.sub), email: typeof claims.email === "string" ? claims.email : undefined, role, accessToken, idToken };
}

export async function requireRole(allowed: AppRole | AppRole[]): Promise<Session> {
  const session = await getSession();
  const list = Array.isArray(allowed) ? allowed : [allowed];
  if (!session) redirect(list.includes("admin") ? "/admin" : "/login");
  if (!list.includes(session.role)) redirect(session.role === "admin" ? "/admin/dashboard" : "/" + session.role);
  return session;
}

export async function getProfileState(session: Session) {
  let accessToken = session.accessToken;
  let response = await fetch(api + "/v1/auth/me", { headers: { authorization: "Bearer " + accessToken }, cache: "no-store" });
  if (response.status === 401) {
    const jar = await cookies();
    const refreshToken = jar.get("md_refresh_token")?.value;
    if (refreshToken) {
      const refreshed = await fetch(api + "/v1/auth/refresh", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ refreshToken }), cache: "no-store" });
      if (refreshed.ok) {
        const data = await refreshed.json();
        accessToken = data.accessToken;
        response = await fetch(api + "/v1/auth/me", { headers: { authorization: "Bearer " + accessToken }, cache: "no-store" });
      }
    }
  }
  if (!response.ok) return null;
  return await response.json() as { user: { id: string; role: AppRole }; profileComplete: boolean };
}
