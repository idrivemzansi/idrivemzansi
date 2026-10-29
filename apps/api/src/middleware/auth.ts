import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, type AppClaims, type AppRole } from "../services/cognito.js";

declare global {
  namespace Express { interface Request { auth?: AppClaims } }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const match = req.header("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) { res.status(401).json({ error: "Authentication required" }); return; }
  try { req.auth = await verifyAccessToken(match[1]); next(); }
  catch { res.status(401).json({ error: "Session expired or invalid" }); }
}

export function requireRole(...roles: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) { res.status(403).json({ error: "Forbidden" }); return; }
    next();
  };
}
