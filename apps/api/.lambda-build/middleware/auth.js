"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.requireRole = requireRole;
const cognito_js_1 = require("../services/cognito.js");
async function requireAuth(req, res, next) {
    const match = req.header("authorization")?.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        res.status(401).json({ error: "Authentication required" });
        return;
    }
    try {
        req.auth = await (0, cognito_js_1.verifyAccessToken)(match[1]);
        next();
    }
    catch {
        res.status(401).json({ error: "Session expired or invalid" });
    }
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.auth || !roles.includes(req.auth.role)) {
            res.status(403).json({ error: "Forbidden" });
            return;
        }
        next();
    };
}
