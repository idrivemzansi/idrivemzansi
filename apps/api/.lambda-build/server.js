"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const node_crypto_1 = require("node:crypto");
const client_sesv2_1 = require("@aws-sdk/client-sesv2");
const zod_1 = require("zod");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const client_sns_1 = require("@aws-sdk/client-sns");
const client_apigatewaymanagementapi_1 = require("@aws-sdk/client-apigatewaymanagementapi");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const livekit_server_sdk_1 = require("livekit-server-sdk");
const dynamodb_js_1 = require("./services/dynamodb.js");
const s3_js_1 = require("./services/s3.js");
const auth_js_1 = require("./middleware/auth.js");
const cognito_js_1 = require("./services/cognito.js");
const paystack_js_1 = require("./services/paystack.js");
const modal_js_1 = require("./services/modal.js");
const ai_contracts_js_1 = require("./services/ai-contracts.js");
const app = (0, express_1.default)();
const ses = new client_sesv2_1.SESv2Client({ region: process.env.AWS_REGION ?? "af-south-1" });
const sns = new client_sns_1.SNSClient({ region: process.env.AWS_REGION ?? "af-south-1" });
const wsManagement = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT ? new client_apigatewaymanagementapi_1.ApiGatewayManagementApiClient({ endpoint: process.env.WEBSOCKET_MANAGEMENT_ENDPOINT, region: process.env.AWS_REGION ?? "af-south-1" }) : undefined;
const localTime = (date) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
const slotKey = (instructorId, start) => `${instructorId}#${start.toISOString()}`;
const activeLock = (item) => Boolean(item && Number(item.expires_at ?? 0) > Math.floor(Date.now() / 1000));
async function getActiveBookingLockIds(ids) {
    ids = [...new Set(ids)];
    const active = new Set();
    for (let offset = 0; offset < ids.length; offset += 100) {
        let pendingKeys = ids.slice(offset, offset + 100).map(id => ({ id }));
        for (let attempt = 0; pendingKeys.length && attempt < 3; attempt++) {
            const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.BatchGetCommand({ RequestItems: { [dynamodb_js_1.tables.bookingLocks]: { Keys: pendingKeys, ConsistentRead: true } } }));
            for (const item of result.Responses?.[dynamodb_js_1.tables.bookingLocks] ?? [])
                if (activeLock(item))
                    active.add(String(item.id));
            pendingKeys = (result.UnprocessedKeys?.[dynamodb_js_1.tables.bookingLocks]?.Keys ?? []);
        }
    }
    return active;
}
function bookingSlotKeys(instructorId, startsAt, durationMinutes) {
    return Array.from({ length: durationMinutes / 30 }, (_, index) => slotKey(instructorId, new Date(startsAt.getTime() + index * 30 * 60000)));
}
function isWithinInstructorAvailability(instructor, startsAt, durationMinutes) {
    const localDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(startsAt);
    if ((instructor.blocked_dates ?? []).includes(localDate))
        return false;
    const parts = Object.fromEntries(localTime(startsAt).map(part => [part.type, part.value]));
    const weekday = String(parts.weekday).toLowerCase();
    const start = `${parts.hour}:${parts.minute}`;
    const endDate = new Date(startsAt.getTime() + durationMinutes * 60000);
    const endParts = Object.fromEntries(localTime(endDate).map(part => [part.type, part.value]));
    const end = `${endParts.hour}:${endParts.minute}`;
    return (instructor.availability_windows ?? []).some((window) => String(window.day).toLowerCase() === weekday && window.start <= start && window.end >= end);
}
async function hasOpenSlotOnDate(instructor, day) {
    if ((instructor.blocked_dates ?? []).includes(day))
        return false;
    const dayDate = new Date(`${day}T12:00:00+02:00`);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Johannesburg", weekday: "long" }).format(dayDate).toLowerCase();
    for (const window of instructor.availability_windows ?? []) {
        if (String(window.day).toLowerCase() !== weekday || !/^\d{2}:\d{2}$/.test(window.start) || !/^\d{2}:\d{2}$/.test(window.end))
            continue;
        const [startHour, startMinute] = window.start.split(":").map(Number);
        const [endHour, endMinute] = window.end.split(":").map(Number);
        for (let minutes = Math.ceil((startHour * 60 + startMinute) / 30) * 30; minutes + 60 <= endHour * 60 + endMinute; minutes += 30) {
            const start = new Date(Date.UTC(dayDate.getUTCFullYear(), dayDate.getUTCMonth(), dayDate.getUTCDate(), Math.floor(minutes / 60) - 2, minutes % 60));
            if (start.getTime() <= Date.now())
                continue;
            const keys = bookingSlotKeys(String(instructor.user_id), start, 60);
            const occupied = await Promise.all(keys.map(id => dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookingLocks, Key: { id } }))));
            if (occupied.every(result => !activeLock(result.Item)))
                return true;
        }
    }
    return false;
}
async function sendEmail(to, subject, body) {
    if (!to || !process.env.SES_FROM_EMAIL)
        return;
    await ses.send(new client_sesv2_1.SendEmailCommand({ FromEmailAddress: process.env.SES_FROM_EMAIL, Destination: { ToAddresses: [to] }, Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: body } } } } }));
}
async function notifyBookingParties(booking, subject, body) {
    const [learner, instructor] = await Promise.all([
        dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: booking.learner_id } })),
        dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: booking.instructor_id } })),
    ]);
    await Promise.all([sendEmail(String(learner.Item?.email ?? ""), subject, body), sendEmail(String(instructor.Item?.email ?? ""), subject, body)]);
}
async function publishWebSocket(userId, payload) { if (!wsManagement)
    return; const connections = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.ScanCommand({ TableName: dynamodb_js_1.tables.notifications, FilterExpression: "user_id=:user AND #type=:type", ExpressionAttributeNames: { "#type": "type" }, ExpressionAttributeValues: { ":user": userId, ":type": "ws_connection" }, Limit: 100 })); await Promise.all((connections.Items ?? []).map(async (connection) => { try {
    await wsManagement.send(new client_apigatewaymanagementapi_1.PostToConnectionCommand({ ConnectionId: String(connection.connection_id), Data: Buffer.from(JSON.stringify(payload)) }));
}
catch (error) {
    if (error?.$metadata?.httpStatusCode === 410)
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.DeleteCommand({ TableName: dynamodb_js_1.tables.notifications, Key: { id: connection.id } })).catch(() => undefined);
    else
        console.error("WebSocket notification failed", error);
} })); }
async function notifyUser(userId, type, title, body, data = {}, id = (0, node_crypto_1.randomUUID)()) {
    try {
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.notifications, Item: { id, user_id: userId, type, title, body, read: false, priority: "normal", data, created_at: new Date().toISOString() }, ConditionExpression: "attribute_not_exists(id)" }));
    }
    catch (error) {
        // A caller-supplied deterministic id already exists: the alert was delivered before, so do not repeat it.
        if (error?.name === "ConditionalCheckFailedException")
            return false;
        throw error;
    }
    await publishWebSocket(userId, { type, title, body, ...data });
    const user = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: userId } }))).Item;
    if (user?.sns_endpoint_arn) {
        if (user.user_type === "instructor") {
            const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: userId } }))).Item;
            const quiet = instructor?.messaging_settings?.quiet_hours;
            if (quiet?.enabled && /^\d{2}:\d{2}$/.test(quiet.start ?? "") && /^\d{2}:\d{2}$/.test(quiet.end ?? "")) {
                const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
                const isQuiet = quiet.start <= quiet.end ? time >= quiet.start && time < quiet.end : time >= quiet.start || time < quiet.end;
                if (isQuiet)
                    return true;
            }
        }
        await sns.send(new client_sns_1.PublishCommand({ TargetArn: user.sns_endpoint_arn, MessageStructure: "json", Message: JSON.stringify({ default: body, GCM: JSON.stringify({ notification: { title, body }, data: { ...data, type } }) }) })).catch(error => console.error("Push notification failed", error));
    }
    return true;
}
async function completeReferral(referredId) {
    const pending = (await scanAll(dynamodb_js_1.tables.referrals)).find(row => row.referred_id === referredId && row.status === "pending");
    if (!pending)
        return;
    const referralId = String(pending.id), referrerId = String(pending.referrer_id), referrerType = String(pending.referrer_type ?? "learner"), referred = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: referredId } }))).Item;
    const prior = (await scanAll(dynamodb_js_1.tables.referrals)).filter(row => row.referrer_id === referrerId && row.status === "completed").length;
    let referrerCredit = 100, referredCredit = 100, tier = "learner";
    if (referrerType === "instructor") {
        const count = prior + 1;
        tier = count <= 2 ? "0-2" : count <= 5 ? "3-5" : count <= 10 ? "6-10" : count <= 20 ? "11-20" : "21+";
        const rewards = { "0-2": [500, 300], "3-5": [750, 400], "6-10": [1000, 500], "11-20": [1500, 600], "21+": [2000, 750] };
        [referrerCredit, referredCredit] = rewards[tier];
    }
    const referrerTable = referrerType === "instructor" ? dynamodb_js_1.tables.instructors : dynamodb_js_1.tables.learners;
    const referredTable = referred?.user_type === "instructor" ? dynamodb_js_1.tables.instructors : dynamodb_js_1.tables.learners;
    const referrerKey = referrerType === "instructor" ? { user_id: referrerId } : { user_id: referrerId };
    try {
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.TransactWriteCommand({ TransactItems: [
                { Update: { TableName: dynamodb_js_1.tables.referrals, Key: { id: referralId }, UpdateExpression: "SET #status=:complete,credits_referrer=:referrer_credit,credits_referred=:referred_credit,tier=:tier,completed_at=:at", ConditionExpression: "#status=:pending", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":complete": "completed", ":pending": "pending", ":referrer_credit": referrerCredit, ":referred_credit": referredCredit, ":tier": tier, ":at": new Date().toISOString() } } },
                { Update: { TableName: referrerTable, Key: referrerKey, UpdateExpression: "SET referral_credits=if_not_exists(referral_credits,:zero)+:credit,total_referrals=if_not_exists(total_referrals,:zero)+:one", ExpressionAttributeValues: { ":zero": 0, ":credit": referrerCredit, ":one": 1 } } },
                { Update: { TableName: referredTable, Key: { user_id: referredId }, UpdateExpression: "SET referral_credits=if_not_exists(referral_credits,:zero)+:credit", ExpressionAttributeValues: { ":zero": 0, ":credit": referredCredit } } },
            ] }));
        await Promise.all([notifyUser(referrerId, "referral_reward", "Referral reward earned", `You earned R${referrerCredit} for a successful referral.`, { referral_id: referralId }), notifyUser(referredId, "referral_reward", "Welcome referral credit", `R${referredCredit} has been added to your account.`, { referral_id: referralId })]);
    }
    catch (error) {
        if (error?.name !== "TransactionCanceledException")
            throw error;
    }
}
async function awardInstructorPoints(instructorId, reason, points, eventId = (0, node_crypto_1.randomUUID)()) { const id = `${instructorId}-${eventId}`; try {
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.achievements, Item: { id, instructor_id: instructorId, badge_name: reason, points, unlocked_at: new Date().toISOString() }, ConditionExpression: "attribute_not_exists(id)" }));
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructorStats, Key: { id: instructorId }, UpdateExpression: "SET instructor_id=:instructor ADD total_points :points", ExpressionAttributeValues: { ":instructor": instructorId, ":points": points } }));
}
catch (error) {
    if (error?.name !== "ConditionalCheckFailedException")
        throw error;
} }
async function releaseBookingLocks(booking) {
    const startsAt = new Date(booking.time);
    const duration = Number(booking.duration_hours) * 60;
    await Promise.all(bookingSlotKeys(String(booking.instructor_id), startsAt, duration).map(id => dynamodb_js_1.docDb.send(new lib_dynamodb_1.DeleteCommand({ TableName: dynamodb_js_1.tables.bookingLocks, Key: { id }, ConditionExpression: "booking_id=:booking", ExpressionAttributeValues: { ":booking": booking.id } })).catch(() => undefined)));
}
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(","), credentials: true }));
app.use(express_1.default.json({ limit: "1mb", verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); } }));
app.get("/health", (_req, res) => res.json({ status: "ok", service: "mzansidrive-api", timezone: "Africa/Johannesburg", currency: "ZAR" }));
const roleSchema = zod_1.z.enum(["learner", "instructor"]);
const emailSchema = zod_1.z.string().trim().email().max(254).transform(v => v.toLowerCase());
function normaliseSaPhone(value) {
    const compact = value.replace(/[\s\-().]/g, "");
    if (/^0[0-9]{9}$/.test(compact))
        return "+27" + compact.slice(1);
    if (/^27[0-9]{9}$/.test(compact))
        return "+" + compact;
    if (/^\+270[0-9]{9}$/.test(compact))
        return "+27" + compact.slice(4);
    if (/^\+27[0-9]{9}$/.test(compact))
        return compact;
    return null;
}
// Accepts 0821234567, +27821234567 or 27821234567 (spaces, dashes, dots and brackets allowed) and stores E.164 +27 form.
const saPhoneSchema = zod_1.z.string().trim().max(40)
    .transform(value => (value === "" ? "" : normaliseSaPhone(value)))
    .refine(value => value !== null, "Use a South African number like +27821234567 or 0821234567.")
    .transform(value => value ?? "");
const phoneSchema = saPhoneSchema.refine(value => value !== "", "Enter your South African mobile number.");
const signupSchema = zod_1.z.object({ email: emailSchema, phone: phoneSchema, password: zod_1.z.string().min(12).max(128), role: roleSchema, terms_accepted: zod_1.z.literal(true), company_invite: zod_1.z.string().uuid().optional(), referral_code: zod_1.z.string().trim().min(4).max(24).optional() });
const confirmSchema = zod_1.z.object({ email: emailSchema, code: zod_1.z.string().trim().min(4).max(12) });
const loginSchema = zod_1.z.object({ email: emailSchema, password: zod_1.z.string().min(1).max(128) });
const tokenPayload = (tokens, role, sub, email) => ({
    accessToken: tokens.AccessToken, idToken: tokens.IdToken, refreshToken: tokens.RefreshToken, expiresIn: tokens.ExpiresIn ?? 3600,
    user: { id: sub, email, role },
});
const requireLearnerComplete = async (req, res, next) => {
    try {
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: req.auth.sub } }));
        if (result.Item?.onboarding_complete !== true) {
            res.status(403).json({ code: "PROFILE_INCOMPLETE", error: "Complete your learner profile before using the app." });
            return;
        }
        next();
    }
    catch (error) {
        next(error);
    }
};
const requireInstructorComplete = async (req, res, next) => {
    try {
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub } }));
        if (result.Item?.onboarding_complete !== true) {
            res.status(403).json({ code: "ONBOARDING_INCOMPLETE", error: "Complete instructor onboarding before using the app." });
            return;
        }
        next();
    }
    catch (error) {
        next(error);
    }
};
const requireCompleteParticipant = async (req, res, next) => { try {
    const table = req.auth?.role === "learner" ? dynamodb_js_1.tables.learners : dynamodb_js_1.tables.instructors;
    const key = req.auth?.role === "learner" ? { user_id: req.auth.sub } : { user_id: req.auth.sub };
    const row = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: table, Key: key }))).Item;
    if (row?.onboarding_complete !== true) {
        res.status(403).json({ code: req.auth?.role === "learner" ? "PROFILE_INCOMPLETE" : "ONBOARDING_INCOMPLETE", error: "Complete your profile before using real-time lesson features." });
        return;
    }
    next();
}
catch (error) {
    next(error);
} };
function publicInstructor(item) {
    const { bank_name: _bankName, bank_code: _bankCode, account_number: _accountNumber, paystack_recipient_code: _recipient, commission_rate: _commissionRate, email: _email, phone: _phone, documents: _documents, document_verification: _documentVerification, verification_notes: _verificationNotes, onboarding_step: _onboardingStep, k53_assessment_id: _assessmentId, ...publicFields } = item;
    return publicFields;
}
async function scanAll(tableName) {
    const items = [];
    let ExclusiveStartKey;
    do {
        const page = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.ScanCommand({ TableName: tableName, Limit: 1000, ExclusiveStartKey }));
        items.push(...(page.Items ?? []));
        ExclusiveStartKey = page.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return items;
}
function companyCanManage(company, auth) {
    const identifiers = new Set([auth.sub.toLowerCase(), String(auth.email ?? "").toLowerCase()].filter(Boolean));
    return ["owners", "admin_contacts"].some(field => (company[field] ?? []).some((entry) => {
        const values = typeof entry === "string" ? [entry] : [entry?.user_id, entry?.id, entry?.email, entry?.contact_email];
        return values.some((value) => typeof value === "string" && identifiers.has(value.toLowerCase()));
    }));
}
async function getManagedCompany(companyId, auth) {
    const company = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: companyId } }))).Item;
    if (!company || !companyCanManage(company, auth))
        return undefined;
    return company;
}
app.post("/v1/auth/signup", async (req, res, next) => {
    try {
        const parsed = signupSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json(schemaError("Enter a valid email, password (12+ characters), and learner or instructor role.", parsed.error));
            return;
        }
        let inviteCompany;
        let referrer;
        if (parsed.data.company_invite) {
            if (parsed.data.role !== "instructor") {
                res.status(400).json({ error: "Company invitations are for instructor accounts." });
                return;
            }
            const companies = await scanAll(dynamodb_js_1.tables.companies);
            inviteCompany = companies.find(company => (company.invitations ?? []).some((invite) => invite.token === parsed.data.company_invite && invite.email === parsed.data.email && invite.status === "pending"));
            if (!inviteCompany) {
                res.status(400).json({ error: "This company invitation is invalid or expired." });
                return;
            }
        }
        if (parsed.data.referral_code) {
            const [learners, instructors] = await Promise.all([scanAll(dynamodb_js_1.tables.learners), scanAll(dynamodb_js_1.tables.instructors)]);
            referrer = [...learners.map((row) => ({ ...row, user_type: "learner" })), ...instructors.map((row) => ({ ...row, user_type: "instructor" }))].find((row) => String(row.referral_code ?? "").toUpperCase() === parsed.data.referral_code.toUpperCase());
            if (!referrer) {
                res.status(400).json({ error: "That referral code could not be found." });
                return;
            }
        }
        const normalizedPhone = parsed.data.phone;
        const result = await (0, cognito_js_1.signup)(parsed.data.email, parsed.data.password, parsed.data.role, normalizedPhone);
        if (result.UserSub) {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.users, Item: { id: result.UserSub, email: parsed.data.email, phone: normalizedPhone, user_type: parsed.data.role, terms_accepted_at: new Date().toISOString(), ...(inviteCompany ? { company_id: inviteCompany.id } : {}), ...(referrer ? { referrer_id: referrer.user_id, referrer_type: referrer.user_type } : {}), otp_verified: false, created_at: new Date().toISOString() } }));
            if (parsed.data.role === "instructor")
                for (const admin of (await scanAll(dynamodb_js_1.tables.users)).filter(user => user.user_type === "admin"))
                    await notifyUser(String(admin.id), "instructor_signup", "New instructor signup", `${parsed.data.email} needs profile verification.`, { instructor_id: result.UserSub });
        }
        res.status(202).json({ status: "verification_required", email: parsed.data.email, role: parsed.data.role });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/auth/confirm", async (req, res, next) => {
    try {
        const parsed = confirmSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: "Enter the email and verification code." });
            return;
        }
        const verified = await (0, cognito_js_1.confirmSignup)(parsed.data.email, parsed.data.code);
        const userBefore = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: verified.sub } }))).Item;
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: verified.sub }, UpdateExpression: "SET otp_verified=:verified,user_type=:role", ExpressionAttributeValues: { ":verified": true, ":role": verified.role } }));
        if (userBefore?.referrer_id)
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.referrals, Item: { id: (0, node_crypto_1.randomUUID)(), referrer_id: userBefore.referrer_id, referrer_type: userBefore.referrer_type ?? "learner", referred_id: verified.sub, status: "pending", credits_referrer: 0, credits_referred: 0, tier: "pending", created_at: new Date().toISOString() } }));
        if (verified.role === "instructor" && userBefore?.company_id) {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: verified.sub }, UpdateExpression: "SET company_id=:company,commission_rate=if_not_exists(commission_rate,:commission),verification_status=if_not_exists(verification_status,:pending)", ExpressionAttributeValues: { ":company": userBefore.company_id, ":commission": 15, ":pending": "pending" } }));
            const company = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: userBefore.company_id } }))).Item;
            if (company) {
                const invitations = (company.invitations ?? []).map((invite) => invite.email === parsed.data.email && invite.status === "pending" ? { ...invite, status: "accepted", accepted_by: verified.sub, accepted_at: new Date().toISOString() } : invite);
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: company.id }, UpdateExpression: "SET invitations=:invitations", ExpressionAttributeValues: { ":invitations": invitations } }));
            }
        }
        res.json({ status: "verified", role: verified.role, next: verified.role === "learner" ? "/complete-profile" : "/instructor/onboarding" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/auth/resend-code", async (req, res, next) => {
    try {
        const parsed = zod_1.z.object({ email: emailSchema }).safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: "Enter a valid email address." });
            return;
        }
        await (0, cognito_js_1.resendCode)(parsed.data.email);
        res.json({ status: "code_sent" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/auth/login", async (req, res, next) => {
    try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: "Enter a valid email and password." });
            return;
        }
        const { tokens, claims } = await (0, cognito_js_1.authenticate)(parsed.data.email, parsed.data.password);
        if (claims.role === "admin") {
            res.status(403).json({ error: "Use the admin sign-in page." });
            return;
        }
        res.json(tokenPayload(tokens, claims.role, claims.sub, claims.email));
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/auth/admin/login", async (req, res, next) => {
    try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: "Enter a valid email and password." });
            return;
        }
        const { tokens, claims } = await (0, cognito_js_1.authenticate)(parsed.data.email, parsed.data.password);
        if (claims.role !== "admin") {
            res.status(403).json({ error: "This account is not assigned to the admin role." });
            return;
        }
        res.json(tokenPayload(tokens, claims.role, claims.sub, claims.email));
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/auth/refresh", async (req, res, next) => {
    try {
        const parsed = zod_1.z.object({ refreshToken: zod_1.z.string().min(20) }).safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: "Refresh token required." });
            return;
        }
        const { tokens, claims } = await (0, cognito_js_1.refreshTokens)(parsed.data.refreshToken);
        res.json(tokenPayload({ ...tokens, RefreshToken: tokens.RefreshToken ?? parsed.data.refreshToken }, claims.role, claims.sub, claims.email));
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/auth/logout", auth_js_1.requireAuth, async (req, res, next) => {
    try {
        const accessToken = req.header("authorization").replace(/^Bearer\s+/i, "");
        const refreshToken = zod_1.z.string().optional().parse(req.body?.refreshToken);
        await (0, cognito_js_1.signOut)(accessToken, refreshToken);
        res.status(204).end();
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/auth/me", auth_js_1.requireAuth, async (req, res, next) => {
    try {
        let profileComplete = true;
        if (req.auth.role === "learner") {
            const item = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: req.auth.sub } }));
            profileComplete = item.Item?.onboarding_complete === true;
        }
        else if (req.auth.role === "instructor") {
            const item = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub } }));
            profileComplete = item.Item?.onboarding_complete === true;
        }
        res.json({ user: { id: req.auth.sub, email: req.auth.email, role: req.auth.role }, profileComplete });
    }
    catch (error) {
        next(error);
    }
});
const searchSchema = zod_1.z.object({ city: zod_1.z.string().optional(), suburb: zod_1.z.string().optional(), lessonType: zod_1.z.string().optional(), transmission: zod_1.z.enum(["manual", "automatic"]).optional(), minPrice: zod_1.z.coerce.number().min(0).optional(), maxPrice: zod_1.z.coerce.number().positive().optional(), minRating: zod_1.z.coerce.number().min(0).max(5).optional(), availability: zod_1.z.string().date().optional(), limit: zod_1.z.coerce.number().min(1).max(50).default(50) });
app.get("/v1/payments/banks", async (_req, res, next) => {
    try {
        const items = await (0, paystack_js_1.paystack)("/bank?currency=ZAR&perPage=200", undefined, "GET");
        res.json({ items: items.map(({ name, code, currency }) => ({ name, code, currency })) });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/enatis/alert-lead", async (req, res, next) => {
    try {
        const body = zod_1.z.object({
            contact: zod_1.z.string().trim().min(3).max(120),
            province: zod_1.z.string().trim().min(2).max(60),
            test_centre: zod_1.z.string().trim().max(80).optional(),
        }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Provide a valid contact and province." });
            return;
        }
        const id = `lead-${(0, node_crypto_1.randomUUID)()}`;
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({
            TableName: dynamodb_js_1.tables.notifications,
            Item: {
                id,
                user_id: "public-leads",
                type: "enatis_lead",
                title: "eNaTIS Alert Subscription",
                body: `Alert requested for ${body.data.province} (${body.data.test_centre || "Any centre"}) by ${body.data.contact}`,
                data: { contact: body.data.contact, province: body.data.province, test_centre: body.data.test_centre ?? "" },
                read: false,
                created_at: new Date().toISOString(),
            }
        }));
        if (body.data.contact.includes("@")) {
            await sendEmail(body.data.contact, "iDriveMzansi eNaTIS Alert Active", `Your eNaTIS test slot alert for ${body.data.province} is active. We'll notify you as soon as matching slots open!`).catch(() => undefined);
        }
        res.status(201).json({ status: "subscribed", message: `Alert active for ${body.data.province}` });
    }
    catch (error) {
        next(error);
    }
});
const centreKey = (value) => String(value ?? "").toLowerCase().replace(/\bdltc\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const provinceKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function slotMatchesPreferences(slot, preferences = []) {
    return preferences.some(pref => provinceKey(pref.province) === provinceKey(slot.province) && (!pref.test_centre || centreKey(pref.test_centre) === centreKey(slot.test_centre)));
}
function leadMatchesSlot(lead, slot) {
    const data = lead.data ?? {};
    if (provinceKey(data.province) !== provinceKey(slot.province))
        return false;
    const centre = String(data.test_centre ?? "");
    return !centre || /^any\b/i.test(centre) || centreKey(centre) === centreKey(slot.test_centre);
}
function enatisSlotId(slot) {
    return `${provinceKey(slot.province)}-${centreKey(slot.test_centre)}-${slot.available_date}`.replace(/\s+/g, "-");
}
const saToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
const saDaysAgo = (days) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date(Date.now() - days * 86_400_000));
const enatisSlotSchema = zod_1.z.object({
    test_centre: zod_1.z.string().trim().min(2).max(80),
    province: zod_1.z.string().trim().min(2).max(60),
    available_date: zod_1.z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
    available_times: zod_1.z.array(zod_1.z.string().trim().regex(/^\d{2}:\d{2}$/, "Use 24-hour HH:MM.")).max(24).default([]),
    status: zod_1.z.enum(["available", "booked", "cancelled"]).default("available"),
    source: zod_1.z.string().trim().max(60).optional(),
});
const MAX_ENATIS_ALERTS = 500;
async function dispatchEnatisAlerts(slots) {
    const result = { learners: 0, leads: 0, truncated: false };
    if (!slots.length)
        return result;
    const [learners, leadRows] = await Promise.all([
        scanAll(dynamodb_js_1.tables.learners),
        dynamodb_js_1.docDb.send(new lib_dynamodb_1.ScanCommand({ TableName: dynamodb_js_1.tables.notifications, FilterExpression: "#type = :type AND user_id = :user", ExpressionAttributeNames: { "#type": "type" }, ExpressionAttributeValues: { ":type": "enatis_lead", ":user": "public-leads" }, Limit: 1000 })),
    ]);
    for (const slot of slots) {
        const when = `${slot.available_date}${slot.available_times?.length ? ` at ${slot.available_times.join(", ")}` : ""}`;
        const title = `New eNaTIS test slot in ${slot.province}`;
        const body = `A driving licence test slot opened at ${slot.test_centre} on ${when}. Slots are released in small batches, so book on eNaTIS as soon as you can. Sign in to iDriveMzansi to review it.`;
        const data = { slot_id: String(slot.id), province: String(slot.province), test_centre: String(slot.test_centre), available_date: String(slot.available_date), link: "/learner" };
        for (const learner of learners) {
            if (result.learners + result.leads >= MAX_ENATIS_ALERTS) {
                result.truncated = true;
                break;
            }
            if (!slotMatchesPreferences(slot, learner.enatis_preferences ?? []))
                continue;
            const fresh = await notifyUser(String(learner.user_id), "enatis_slot", title, body, data, `enatis-${slot.id}-${slot.available_since}-${learner.user_id}`);
            if (!fresh)
                continue;
            const user = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: learner.user_id } }))).Item ?? {};
            await sendEmail(String(user.email ?? ""), `New driving licence test slot · ${slot.test_centre}`, body).catch(error => console.error("eNaTIS slot email failed", error));
            result.learners++;
        }
        for (const lead of leadRows.Items ?? []) {
            if (result.learners + result.leads >= MAX_ENATIS_ALERTS) {
                result.truncated = true;
                break;
            }
            if (!leadMatchesSlot(lead, slot))
                continue;
            const contact = String(lead.data?.contact ?? "");
            if (!contact)
                continue;
            const alertId = `enatis-${slot.id}-${slot.available_since}-lead-${(0, node_crypto_1.createHash)("sha256").update(contact.toLowerCase()).digest("hex").slice(0, 16)}`;
            let fresh = true;
            try {
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.notifications, Item: { id: alertId, user_id: "public-leads", type: "enatis_lead_alert", title, body, read: false, priority: "normal", data: { ...data, contact }, created_at: new Date().toISOString() }, ConditionExpression: "attribute_not_exists(id)" }));
            }
            catch (error) {
                if (error?.name !== "ConditionalCheckFailedException")
                    throw error;
                fresh = false;
            }
            if (!fresh)
                continue;
            if (contact.includes("@"))
                await sendEmail(contact, `New driving licence test slot · ${slot.test_centre}`, body).catch(error => console.error("eNaTIS lead email failed", error));
            result.leads++;
        }
        if (result.truncated)
            break;
    }
    return result;
}
// Partner slot feed: DLTC monitors, driving schools or a manual curation job POST observed availability here.
app.post("/v1/enatis/slots", async (req, res, next) => {
    try {
        const configured = process.env.ENATIS_INGEST_TOKEN;
        if (!configured) {
            res.status(503).json({ error: "Slot ingestion is disabled. Set ENATIS_INGEST_TOKEN in the API environment." });
            return;
        }
        const provided = String(req.header("x-enatis-token") ?? "").trim() || String(req.header("authorization") ?? "").replace(/^bearer\s+/i, "").trim();
        const supplied = Buffer.from(provided, "utf8");
        const expected = Buffer.from(configured, "utf8");
        if (supplied.length !== expected.length || !(0, node_crypto_1.timingSafeEqual)(supplied, expected)) {
            res.status(401).json({ error: "A valid partner token is required." });
            return;
        }
        const body = zod_1.z.object({ slots: zod_1.z.array(enatisSlotSchema).min(1).max(100) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json(schemaError("Invalid slot payload.", body.error));
            return;
        }
        const now = new Date().toISOString();
        const today = saToday();
        const prepared = await Promise.all(body.data.slots.map(async (input) => {
            const id = enatisSlotId(input);
            const prior = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.enatisSlots, Key: { id } }))).Item;
            // A slot whose date has already passed can never be booked: store it expired so it neither shows in the dashboard nor alerts.
            const status = input.status === "available" && input.available_date < today ? "expired" : input.status;
            const available = status === "available";
            const available_times = available ? [...new Set([...(Array.isArray(prior?.available_times) ? prior.available_times : []), ...input.available_times])].sort() : [];
            // available_since marks the current open run, so a slot that is booked and then released again alerts once more.
            const available_since = prior?.status === "available" && prior?.available_since ? String(prior.available_since) : now;
            const item = { id, test_centre: input.test_centre, province: input.province, available_date: input.available_date, available_times, status, source: input.source ?? prior?.source ?? "partner", available_since, first_seen_at: prior?.first_seen_at ?? now, last_seen_at: now };
            return { item, newlyAvailable: available && prior?.status !== "available" };
        }));
        await Promise.all(prepared.map(entry => dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.enatisSlots, Item: entry.item }))));
        const freshSlots = prepared.filter(entry => entry.newlyAvailable).map(entry => entry.item);
        const alerted = await dispatchEnatisAlerts(freshSlots);
        res.status(201).json({ received: prepared.length, new_slots: freshSlots.length, new_slot_ids: freshSlots.map(slot => slot.id), alerted });
    }
    catch (error) {
        next(error);
    }
});
// A driving licence test slot is only useful until its date, so availability that has passed is marked expired.
// Both readers (the learner dashboard and enatis_check) already filter on status === "available", so nothing else has to change.
async function expireStaleEnatisSlots() {
    const today = saToday();
    const slots = await scanAll(dynamodb_js_1.tables.enatisSlots);
    const stale = slots.filter(slot => slot.status === "available" && String(slot.available_date ?? "") < today);
    const now = new Date().toISOString();
    await Promise.all(stale.map(slot => dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({
        TableName: dynamodb_js_1.tables.enatisSlots,
        Key: { id: slot.id },
        UpdateExpression: "SET #status=:status, expired_at=:now, last_seen_at=:now",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":status": "expired", ":now": now },
    }))));
    return { checked: slots.length, expired: stale.length };
}
// Same shared secret and header as the reminder dispatcher, so EventBridge can drive both jobs and an operator can run one by hand.
app.post("/v1/internal/enatis/expire", async (req, res, next) => {
    try {
        if (!process.env.EVENTBRIDGE_REMINDER_TOKEN || req.header("x-reminder-token") !== process.env.EVENTBRIDGE_REMINDER_TOKEN) {
            res.status(401).json({ error: "Unauthorized." });
            return;
        }
        res.json(await expireStaleEnatisSlots());
    }
    catch (error) {
        next(error);
    }
});
// Runs inside the API process so expiry needs no extra infrastructure; every run only scans one small table.
const enatisExpiryMinutes = Math.max(1, Number(process.env.ENATIS_EXPIRY_INTERVAL_MINUTES) || 15);
const runEnatisExpiry = () => {
    void expireStaleEnatisSlots()
        .then(result => { if (result.expired)
        console.log(`eNaTIS: expired ${result.expired} stale slot(s)`); })
        .catch(error => console.error("eNaTIS slot expiry failed", error));
};
runEnatisExpiry();
setInterval(runEnatisExpiry, enatisExpiryMinutes * 60_000).unref();
app.get("/v1/instructors", async (req, res, next) => {
    try {
        const parsed = searchSchema.safeParse(req.query);
        if (!parsed.success) {
            res.status(400).json({ error: "Invalid search filters" });
            return;
        }
        const city = parsed.data.city ?? "Johannesburg";
        const result = city.toLowerCase() === "anywhere" ? { Items: await scanAll(dynamodb_js_1.tables.instructors) } : await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.instructors, IndexName: "CityListings", KeyConditionExpression: "#city = :city", ExpressionAttributeNames: { "#city": "city" }, ExpressionAttributeValues: { ":city": city }, Limit: parsed.data.limit }));
        let items = (result.Items ?? []).filter(row => row.verification_status === "active");
        if (parsed.data.transmission)
            items = items.filter(row => row.transmission === parsed.data.transmission);
        if (parsed.data.minPrice !== undefined)
            items = items.filter(row => Number(row.hourly_rate) >= parsed.data.minPrice);
        if (parsed.data.maxPrice)
            items = items.filter(row => Number(row.hourly_rate) <= parsed.data.maxPrice);
        if (parsed.data.suburb)
            items = items.filter(row => (row.suburbs_covered ?? []).some((v) => v.toLowerCase().includes(parsed.data.suburb.toLowerCase())));
        if (parsed.data.lessonType)
            items = items.filter(row => (row.lesson_types ?? []).some((v) => v.toLowerCase() === parsed.data.lessonType.toLowerCase()));
        if (parsed.data.minRating)
            items = items.filter(row => Number(row.avg_rating ?? row.rating ?? 0) >= parsed.data.minRating);
        if (parsed.data.availability) {
            const checks = await Promise.all(items.map(async (row) => await hasOpenSlotOnDate(row, parsed.data.availability)));
            items = items.filter((_row, index) => checks[index]);
        }
        const companyPremier = new Set((await scanAll(dynamodb_js_1.tables.companies)).filter(company => String(company.membership_tier ?? "").toLowerCase() === "premier" && (!company.membership_expiry || new Date(company.membership_expiry).getTime() > Date.now())).map(company => String(company.id)));
        items.sort((a, b) => { const premier = (row) => (String(row.membership_tier ?? "").toLowerCase() === "premier" || companyPremier.has(String(row.company_id ?? ""))) && (!row.membership_expiry || new Date(row.membership_expiry).getTime() > Date.now()) ? 1 : 0; return premier(b) - premier(a) || Number(b.avg_rating ?? 0) - Number(a.avg_rating ?? 0); });
        res.json({ items: items.map(publicInstructor), nextToken: "LastEvaluatedKey" in result ? result.LastEvaluatedKey ?? null : null, currency: "ZAR" });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/instructors/:id", async (req, res, next) => {
    try {
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.params.id } }));
        if (!result.Item || result.Item.verification_status !== "active") {
            res.status(404).json({ error: "Instructor not found" });
            return;
        }
        res.json({ item: publicInstructor(result.Item) });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/instructors/:id/reviews", async (req, res, next) => {
    try {
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.reviews, IndexName: "InstructorReviews", KeyConditionExpression: "instructor_id=:id", ExpressionAttributeValues: { ":id": req.params.id }, ScanIndexForward: false, Limit: 50 }));
        const items = (result.Items ?? []).filter(review => review.is_public !== false);
        res.json({ items });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/bookings/:id/reviews", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), requireLearnerComplete, async (req, res, next) => {
    try {
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: String(req.params.id) } }))).Item;
        const body = zod_1.z.object({ overall_rating: zod_1.z.number().int().min(1).max(5), punctuality: zod_1.z.number().int().min(1).max(5), teaching_quality: zod_1.z.number().int().min(1).max(5), vehicle_condition: zod_1.z.number().int().min(1).max(5), comments: zod_1.z.string().max(3000).default(""), went_well: zod_1.z.string().max(2000).default(""), improvements: zod_1.z.string().max(2000).default(""), is_public: zod_1.z.boolean().default(true) }).safeParse(req.body);
        if (!booking || booking.learner_id !== req.auth.sub || booking.status !== "completed" || !body.success) {
            res.status(400).json({ error: "Reviews are available after your completed lesson." });
            return;
        }
        const exists = (await scanAll(dynamodb_js_1.tables.reviews)).some(row => row.booking_id === booking.id);
        if (exists) {
            res.status(409).json({ error: "You have already reviewed this lesson." });
            return;
        }
        let sentiment = { sentiment: "mixed", themes: [], moderation_flag: false };
        try {
            sentiment = await (0, modal_js_1.infer)("review-sentiment", { comments: body.data.comments, went_well: body.data.went_well, improvements: body.data.improvements });
        }
        catch { }
        const item = { id: `review-${booking.id}`, booking_id: booking.id, instructor_id: booking.instructor_id, learner_id: req.auth.sub, ...body.data, sentiment, created_at: new Date().toISOString() };
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.reviews, Item: item, ConditionExpression: "attribute_not_exists(id)" }));
        if (body.data.overall_rating >= 4)
            await awardInstructorPoints(String(booking.instructor_id), "Positive learner review", 25, `positive-review-${booking.id}`);
        res.status(201).json({ item });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/bookings/:id/learner-review", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: String(req.params.id) } }))).Item;
        const body = zod_1.z.object({ attitude: zod_1.z.number().int().min(1).max(5), punctuality: zod_1.z.number().int().min(1).max(5), progress_rating: zod_1.z.number().int().min(1).max(5), feedback: zod_1.z.string().max(2000).default("") }).safeParse(req.body);
        if (!booking || booking.instructor_id !== req.auth.sub || booking.status !== "completed" || !body.success) {
            res.status(400).json({ error: "Learner reviews require a completed lesson." });
            return;
        }
        const existing = (await scanAll(dynamodb_js_1.tables.learnerReviews)).some(row => row.booking_id === booking.id);
        if (existing) {
            res.status(409).json({ error: "Learner feedback has already been submitted." });
            return;
        }
        const item = { id: `learner-review-${booking.id}`, booking_id: booking.id, instructor_id: req.auth.sub, learner_id: booking.learner_id, ...body.data, created_at: new Date().toISOString() };
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.learnerReviews, Item: item }));
        res.status(201).json({ item });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/instructors/:id/smart-schedule", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), requireLearnerComplete, async (req, res, next) => {
    try {
        const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.params.id } }))).Item;
        if (!instructor || instructor.verification_status !== "active") {
            res.status(404).json({ error: "Instructor not found." });
            return;
        }
        const duration = zod_1.z.number().int().min(30).max(180).multipleOf(30).safeParse(req.body?.durationMinutes ?? 60);
        if (!duration.success) {
            res.status(400).json({ error: "Invalid lesson duration." });
            return;
        }
        const candidates = [];
        const now = Date.now();
        for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
            const dayDate = new Date(now + dayOffset * 86400000);
            const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg", year: "numeric", month: "2-digit", day: "2-digit" }).format(dayDate);
            if ((instructor.blocked_dates ?? []).includes(dayKey))
                continue;
            const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Johannesburg", weekday: "long" }).format(dayDate).toLowerCase();
            for (const window of instructor.availability_windows ?? []) {
                if (String(window.day).toLowerCase() !== weekday || !/^\d{2}:\d{2}$/.test(window.start) || !/^\d{2}:\d{2}$/.test(window.end))
                    continue;
                const [startHour, startMinute] = window.start.split(":").map(Number);
                const [endHour, endMinute] = window.end.split(":").map(Number);
                for (let minutes = Math.ceil((startHour * 60 + startMinute) / 30) * 30; minutes + duration.data <= endHour * 60 + endMinute; minutes += 30) {
                    const local = new Date(Date.UTC(dayDate.getUTCFullYear(), dayDate.getUTCMonth(), dayDate.getUTCDate(), Math.floor(minutes / 60) - 2, minutes % 60));
                    if (local.getTime() > now + 3600000)
                        candidates.push(local);
                }
            }
        }
        const free = [];
        const candidateStarts = candidates.slice(0, 240);
        const keys = candidateStarts.flatMap(start => bookingSlotKeys(String(req.params.id), start, duration.data));
        const activeLocks = await getActiveBookingLockIds(keys);
        for (const start of candidateStarts)
            if (bookingSlotKeys(String(req.params.id), start, duration.data).every(key => !activeLocks.has(key)))
                free.push({ starts_at: start.toISOString(), duration_minutes: duration.data });
        if (free.length === 0) {
            res.json({ items: [], message: "No published slots are currently available. Check back soon." });
            return;
        }
        const history = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.bookings, IndexName: "InstructorBookings", KeyConditionExpression: "instructor_id=:id", ExpressionAttributeValues: { ":id": req.params.id }, Limit: 100 }));
        const result = await (0, modal_js_1.infer)("availability-optimizer", { booking_history: history.Items ?? [], cancellations: (history.Items ?? []).filter(row => row.status === "cancelled"), current_availability: { windows: instructor.availability_windows ?? [], candidate_slots: free } });
        const availableStarts = new Set(free.map(item => item.starts_at));
        res.json({ items: result.optimal_slots.filter(item => availableStarts.has(item.starts_at)).slice(0, 5), effectiveness_score: result.effectiveness_score });
    }
    catch (error) {
        next(error);
    }
});
app.put("/v1/instructors/me/availability", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const parsed = zod_1.z.object({ availability_windows: zod_1.z.array(zod_1.z.object({ day: zod_1.z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]), start: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })).max(56), own_vehicle_allowed: zod_1.z.boolean(), own_vehicle_discount_percent: zod_1.z.number().min(0).max(50) }).safeParse(req.body);
        if (!parsed.success || parsed.data.availability_windows.some(w => w.start >= w.end) || (parsed.data.own_vehicle_allowed && parsed.data.own_vehicle_discount_percent <= 0)) {
            res.status(400).json({ error: "Add valid weekly availability windows and a positive own-vehicle discount." });
            return;
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub }, UpdateExpression: "SET availability_windows=:windows,own_vehicle_allowed=:allowed,own_vehicle_discount_percent=:discount", ExpressionAttributeValues: { ":windows": parsed.data.availability_windows, ":allowed": parsed.data.own_vehicle_allowed, ":discount": parsed.data.own_vehicle_discount_percent } }));
        res.json({ status: "saved" });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/learners/me/bookings", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), requireLearnerComplete, async (req, res, next) => {
    try {
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.bookings, IndexName: "LearnerBookings", KeyConditionExpression: "learner_id=:id", ExpressionAttributeValues: { ":id": req.auth.sub }, Limit: 100 }));
        res.json({ items: result.Items ?? [] });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/instructors/me/bookings", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.bookings, IndexName: "InstructorBookings", KeyConditionExpression: "instructor_id=:id", ExpressionAttributeValues: { ":id": req.auth.sub }, Limit: 100 }));
        res.json({ items: result.Items ?? [] });
    }
    catch (error) {
        next(error);
    }
});
const alignedDateTime = zod_1.z.string().datetime({ offset: true }).refine(value => { const date = new Date(value); return date.getMinutes() % 30 === 0 && date.getUTCSeconds() === 0; }, "Choose a time on the hour or half hour.");
const bookingSchema = zod_1.z.object({ instructorId: zod_1.z.string().min(1), lessonType: zod_1.z.string().trim().min(1).max(80), startsAt: alignedDateTime, durationMinutes: zod_1.z.number().int().min(30).max(180).multipleOf(30), transmission: zod_1.z.enum(["manual", "automatic"]), pickupAddress: zod_1.z.string().trim().min(8).max(400), pickupSuburb: zod_1.z.string().trim().min(2).max(80), pickupCity: zod_1.z.string().trim().min(2).max(80), pickupPostalCode: zod_1.z.string().regex(/^\d{4}$/), pickupCoordinates: zod_1.z.object({ latitude: zod_1.z.number().min(-90).max(90), longitude: zod_1.z.number().min(-180).max(180) }).optional(), specialRequests: zod_1.z.string().max(1000).optional(), ownVehicle: zod_1.z.boolean().default(false) });
app.post("/v1/bookings", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), requireLearnerComplete, async (req, res, next) => {
    try {
        const parsed = bookingSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: "Invalid booking details" });
            return;
        }
        const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: parsed.data.instructorId } }))).Item;
        if (!instructor || instructor.verification_status !== "active") {
            res.status(404).json({ error: "Active instructor not found." });
            return;
        }
        if (instructor.transmission !== "both" && instructor.transmission !== parsed.data.transmission) {
            res.status(400).json({ error: "Instructor does not offer this transmission." });
            return;
        }
        if (!(instructor.lesson_types ?? []).includes(parsed.data.lessonType)) {
            res.status(400).json({ error: "This instructor does not offer the selected lesson type." });
            return;
        }
        const learner = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: req.auth.sub } }))).Item;
        const email = req.auth.email ?? (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: req.auth.sub } }))).Item?.email;
        if (!email) {
            res.status(400).json({ error: "A verified email is required for checkout." });
            return;
        }
        const hourlyRate = Number(instructor.hourly_rate);
        if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
            res.status(400).json({ error: "Instructor pricing is unavailable." });
            return;
        }
        const startsAt = new Date(parsed.data.startsAt);
        if (startsAt.getTime() < Date.now() + 60 * 60000) {
            res.status(400).json({ error: "Choose a lesson at least one hour from now." });
            return;
        }
        if (!isWithinInstructorAvailability(instructor, startsAt, parsed.data.durationMinutes)) {
            res.status(409).json({ error: "That time is outside the instructor's published availability." });
            return;
        }
        if (parsed.data.ownVehicle && instructor.own_vehicle_allowed !== true) {
            res.status(400).json({ error: "This instructor does not allow learner-owned vehicles." });
            return;
        }
        const durationHours = parsed.data.durationMinutes / 60;
        const vehicleDiscountRate = parsed.data.ownVehicle ? Math.max(0, Math.min(50, Number(instructor.own_vehicle_discount_percent ?? 0))) : 0;
        const totalAmount = Math.round(hourlyRate * durationHours * (1 - vehicleDiscountRate / 100) * 100) / 100;
        const credits = Math.max(0, Number(learner?.referral_credits ?? 0));
        const discountAmount = Math.min(100, credits, totalAmount);
        const amountDue = Math.round((totalAmount - discountAmount) * 100) / 100;
        if (amountDue <= 0) {
            res.status(400).json({ error: "The lesson must have a positive payment after credits." });
            return;
        }
        const bookingId = (0, node_crypto_1.randomUUID)();
        const reference = `md-${bookingId}`;
        const commissionRate = Math.max(0, Math.min(50, Number(instructor.commission_rate ?? 15)));
        const platformFee = Math.round(totalAmount * commissionRate) / 100;
        const instructorPayout = Math.round((totalAmount - platformFee) * 100) / 100;
        const item = {
            id: bookingId, learner_id: req.auth.sub, instructor_id: parsed.data.instructorId,
            company_id: instructor.company_id ?? null, lesson_type: parsed.data.lessonType, transmission: parsed.data.transmission,
            date: startsAt.toISOString().slice(0, 10), time: startsAt.toISOString(), duration_hours: durationHours,
            pickup_address: `${parsed.data.pickupAddress}, ${parsed.data.pickupSuburb}, ${parsed.data.pickupCity}, ${parsed.data.pickupPostalCode}, South Africa`, ...(parsed.data.pickupCoordinates ? { pickup_coordinates: parsed.data.pickupCoordinates } : {}), special_requests: parsed.data.specialRequests ?? "", own_vehicle: parsed.data.ownVehicle, own_vehicle_discount_percent: vehicleDiscountRate,
            status: "pending", payment_status: "pending", total_amount: totalAmount, discount_amount: discountAmount,
            amount_charged: amountDue, currency: "ZAR", commission_rate: commissionRate,
            platform_fee: platformFee, instructor_payout: instructorPayout, payment_reference: reference,
            learner_confirmed_complete: false, instructor_marked_complete: false, instructor_response: "pending", created_at: new Date().toISOString(), reminders_sent: [],
            reminders: [168, 72, 24, 2, 3, 1].map(hours => ({ hours_before: hours, due_at: new Date(startsAt.getTime() - hours * 3600000).toISOString(), sent: false })).filter(reminder => Date.parse(reminder.due_at) >= Date.now() - 300000),
        };
        const locks = bookingSlotKeys(parsed.data.instructorId, startsAt, parsed.data.durationMinutes);
        const existingBookings = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.bookings, IndexName: "InstructorBookings", KeyConditionExpression: "instructor_id=:instructor AND #date BETWEEN :from AND :through", ExpressionAttributeNames: { "#date": "date" }, ExpressionAttributeValues: { ":instructor": parsed.data.instructorId, ":from": new Date(startsAt.getTime() - 86400000).toISOString().slice(0, 10), ":through": new Date(startsAt.getTime() + 86400000).toISOString().slice(0, 10) }, Limit: 1000 }));
        const requestedEnd = startsAt.getTime() + parsed.data.durationMinutes * 60000;
        if ((existingBookings.Items ?? []).some(existing => ["pending", "confirmed"].includes(existing.status) && (existing.status === "confirmed" || existing.payment_status === "paid" || Date.now() - Date.parse(existing.created_at) < 15 * 60000) && Date.parse(existing.time) < requestedEnd && Date.parse(existing.time) + Number(existing.duration_hours) * 3600000 > startsAt.getTime())) {
            res.status(409).json({ error: "The instructor already has a lesson at that time. Please choose another slot." });
            return;
        }
        try {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.TransactWriteCommand({ TransactItems: [
                    { Put: { TableName: dynamodb_js_1.tables.bookings, Item: item, ConditionExpression: "attribute_not_exists(id)" } },
                    ...locks.map(id => ({ Put: { TableName: dynamodb_js_1.tables.bookingLocks, Item: { id, booking_id: bookingId, instructor_id: parsed.data.instructorId, starts_at: id.split("#")[1], expires_at: Math.floor((Date.now() + 15 * 60000) / 1000) }, ConditionExpression: "attribute_not_exists(id) OR expires_at <= :now", ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) } } })),
                ] }));
        }
        catch (error) {
            if (error.name === "TransactionCanceledException") {
                res.status(409).json({ error: "That lesson time was just booked. Please choose another slot." });
                return;
            }
            throw error;
        }
        const callbackUrl = process.env.PAYSTACK_CALLBACK_URL ?? `${(process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",")[0]}/learner/lessons?payment=return`;
        try {
            const checkout = await (0, paystack_js_1.paystack)("/transaction/initialize", {
                email, amount: String((0, paystack_js_1.toMinorUnits)(amountDue)), currency: "ZAR", reference, callback_url: callbackUrl, channels: [...paystack_js_1.PAYSTACK_CHANNELS],
                metadata: { booking_id: bookingId, learner_id: req.auth.sub, kind: "lesson_booking", discount_amount: discountAmount },
            });
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Item: { id: checkout.reference, booking_id: bookingId, user_id: req.auth.sub, instructor_id: parsed.data.instructorId, kind: "lesson_booking", amount: amountDue, currency: "ZAR", status: "pending", created_at: new Date().toISOString() } }));
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET payment_reference=:reference,checkout_url=:url", ExpressionAttributeValues: { ":reference": checkout.reference, ":url": checkout.authorization_url } }));
            res.status(201).json({ bookingId, authorizationUrl: checkout.authorization_url, reference: checkout.reference, totalAmount, discountAmount, amountDue, currency: "ZAR", ownVehicleDiscountPercent: vehicleDiscountRate });
        }
        catch (error) {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET payment_status=:failed,status=:cancelled,payment_error=:error", ExpressionAttributeValues: { ":failed": "failed", ":cancelled": "cancelled", ":error": "Checkout initialization failed" } }));
            await Promise.all(locks.map(id => dynamodb_js_1.docDb.send(new lib_dynamodb_1.DeleteCommand({ TableName: dynamodb_js_1.tables.bookingLocks, Key: { id }, ConditionExpression: "booking_id=:booking", ExpressionAttributeValues: { ":booking": bookingId } })).catch(() => undefined)));
            throw error;
        }
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/payments/paystack/webhook", async (req, res, next) => {
    try {
        const rawBody = req.rawBody;
        if (!rawBody || !(0, paystack_js_1.verifyWebhook)(rawBody, req.header("x-paystack-signature"))) {
            res.status(401).json({ error: "Invalid webhook signature." });
            return;
        }
        const event = req.body;
        const data = event.data ?? {};
        const reference = String(data.reference ?? "");
        if (event.event === "invoice.update" && data.status === "success") {
            const email = String(data.customer?.email ?? "").toLowerCase();
            let memberSub = "";
            if (email) {
                const users = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.users, IndexName: "EmailLookup", KeyConditionExpression: "email=:email", ExpressionAttributeValues: { ":email": email }, Limit: 1 }));
                const sub = String(users.Items?.[0]?.id ?? "");
                memberSub = sub;
                const instructor = sub ? (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: sub } }))).Item : undefined;
                const tier = instructor?.membership_plan ?? instructor?.membership_tier;
                if (tier === "weekly" || tier === "monthly") {
                    const expiry = new Date();
                    expiry.setDate(expiry.getDate() + (tier === "weekly" ? 7 : 30));
                    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: sub }, UpdateExpression: "SET membership_expiry=:expiry,membership_payment_status=:paid", ExpressionAttributeValues: { ":expiry": expiry.toISOString(), ":paid": "active" } }));
                }
            }
            if (data.id)
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Item: { id: `invoice-${data.id}`, user_id: memberSub, kind: "instructor_membership_renewal", amount: (0, paystack_js_1.fromMinorUnits)(Number(data.amount ?? 0)), currency: String(data.currency ?? "ZAR"), status: "success", created_at: String(data.paid_at ?? new Date().toISOString()) } }));
            res.sendStatus(200);
            return;
        }
        if (event.event === "invoice.payment_failed") {
            const email = String(data.customer?.email ?? "").toLowerCase();
            if (email) {
                const users = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.users, IndexName: "EmailLookup", KeyConditionExpression: "email=:email", ExpressionAttributeValues: { ":email": email }, Limit: 1 }));
                const sub = String(users.Items?.[0]?.id ?? "");
                if (sub)
                    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: sub }, UpdateExpression: "SET membership_payment_status=:failed", ExpressionAttributeValues: { ":failed": "past_due" } }));
            }
            res.sendStatus(200);
            return;
        }
        if (event.event === "charge.failed" || event.event === "transaction.failed") {
            const transaction = reference ? (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Key: { id: reference } }))).Item : undefined;
            const failedBookingId = String(data.metadata?.booking_id ?? transaction?.booking_id ?? "");
            if (failedBookingId) {
                const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: failedBookingId } }))).Item;
                if (booking?.payment_status === "pending") {
                    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET payment_status=:failed,#status=:cancelled,payment_failure_at=:at", ConditionExpression: "payment_status=:pending", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":failed": "failed", ":cancelled": "cancelled", ":at": new Date().toISOString(), ":pending": "pending" } }));
                    await releaseBookingLocks(booking);
                }
            }
            if (reference)
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Key: { id: reference }, UpdateExpression: "SET #status=:failed,amount=:amount,updated_at=:at", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":failed": "failed", ":amount": (0, paystack_js_1.fromMinorUnits)(Number(data.amount ?? 0)), ":at": new Date().toISOString() } }));
            res.sendStatus(200);
            return;
        }
        if (event.event === "transfer.success" || event.event === "transfer.failed" || event.event === "transfer.reversed") {
            const transferRef = String(data.reference ?? "");
            const payoutRows = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.ScanCommand({ TableName: dynamodb_js_1.tables.payouts, FilterExpression: "paystack_reference=:reference OR booking_id=:booking", ExpressionAttributeValues: { ":reference": transferRef, ":booking": transferRef.startsWith("mdp-") && !transferRef.startsWith("mdp-manual-") ? transferRef.slice(4) : "__none__" }, Limit: 1 }));
            const payout = payoutRows.Items?.[0];
            if (payout) {
                const success = event.event === "transfer.success";
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: payout.id }, UpdateExpression: "SET #status=:status,paystack_transfer_code=:code,transfer_updated_at=:at", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":status": success ? "completed" : "failed", ":code": String(data.transfer_code ?? ""), ":at": new Date().toISOString() } }));
                if (payout.booking_id)
                    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: payout.booking_id }, UpdateExpression: "SET payout_status=:status", ExpressionAttributeValues: { ":status": success ? "completed" : "failed" } }));
                if (Array.isArray(payout.booking_ids))
                    await Promise.all(payout.booking_ids.map(async (bookingId) => { await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET payout_status=:status", ExpressionAttributeValues: { ":status": success ? "completed" : "failed" } })); const lessonPayoutId = `booking-${bookingId}`; await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: lessonPayoutId }, UpdateExpression: "SET #status=:status,processed_at=:at", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":status": success ? "completed" : "failed", ":at": new Date().toISOString() } })).catch(() => undefined); }));
                if (success && payout.instructor_id) {
                    const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: payout.instructor_id } }))).Item;
                    const user = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: payout.instructor_id } }))).Item;
                    const message = `Your payout of R${Number(payout.amount ?? 0).toFixed(2)} has been processed.`;
                    await sendEmail(String(instructor?.email ?? user?.email ?? ""), "iDriveMzansi payout processed", message);
                    await notifyUser(String(payout.instructor_id), "payout_processed", "Payout processed", message);
                }
            }
            res.sendStatus(200);
            return;
        }
        if (event.event === "refund.processed" || event.event === "refund.failed") {
            const refundReference = String(data.transaction_reference ?? data.transaction?.reference ?? "");
            const refundRows = refundReference ? await dynamodb_js_1.docDb.send(new lib_dynamodb_1.ScanCommand({ TableName: dynamodb_js_1.tables.bookings, FilterExpression: "payment_reference=:reference", ExpressionAttributeValues: { ":reference": refundReference }, Limit: 1 })) : { Items: [] };
            const refundBookingId = String(data.metadata?.booking_id ?? refundRows.Items?.[0]?.id ?? "");
            if (refundBookingId) {
                const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: refundBookingId } }))).Item;
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: refundBookingId }, UpdateExpression: "SET refund_status=:status,payment_status=:payment", ExpressionAttributeValues: { ":status": event.event === "refund.processed" ? "completed" : "failed", ":payment": event.event === "refund.processed" ? "refunded" : "paid" } }));
                if (booking?.payment_reference)
                    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Key: { id: booking.payment_reference }, UpdateExpression: "SET refund_status=:status,updated_at=:at", ExpressionAttributeValues: { ":status": event.event === "refund.processed" ? "completed" : "failed", ":at": new Date().toISOString() } }));
                if (event.event === "refund.processed" && booking && Number(booking.discount_amount) > 0 && booking.referral_credits_debited === true) {
                    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.TransactWriteCommand({ TransactItems: [
                            { Update: { TableName: dynamodb_js_1.tables.learners, Key: { user_id: booking.learner_id }, UpdateExpression: "SET referral_credits=if_not_exists(referral_credits,:zero)+:credit", ExpressionAttributeValues: { ":zero": 0, ":credit": Number(booking.discount_amount) } } },
                            { Update: { TableName: dynamodb_js_1.tables.bookings, Key: { id: refundBookingId }, UpdateExpression: "SET referral_credits_restored=:yes", ConditionExpression: "attribute_not_exists(referral_credits_restored)", ExpressionAttributeValues: { ":yes": true } } },
                        ] })).catch(error => { if (error.name !== "TransactionCanceledException")
                        throw error; });
                }
            }
            res.sendStatus(200);
            return;
        }
        if (event.event === "refund.pending" || event.event === "refund.processing") {
            const refundReference = String(data.transaction_reference ?? "");
            if (refundReference) {
                const refundRows = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.ScanCommand({ TableName: dynamodb_js_1.tables.bookings, FilterExpression: "payment_reference=:reference", ExpressionAttributeValues: { ":reference": refundReference }, Limit: 1 }));
                const booking = refundRows.Items?.[0];
                if (booking)
                    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET refund_status=:status", ExpressionAttributeValues: { ":status": event.event === "refund.pending" ? "pending" : "processing" } }));
            }
            res.sendStatus(200);
            return;
        }
        if (event.event !== "charge.success" && event.event !== "transaction.success") {
            res.sendStatus(200);
            return;
        }
        const verify = await (0, paystack_js_1.paystack)(`/transaction/verify/${encodeURIComponent(reference)}`, undefined, "GET");
        if (verify.status !== "success" || verify.currency !== "ZAR") {
            res.sendStatus(200);
            return;
        }
        const bookingId = String(verify.metadata?.booking_id ?? data.metadata?.booking_id ?? "");
        if (bookingId) {
            const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId } }))).Item;
            if (!booking || booking.payment_reference !== reference || (0, paystack_js_1.toMinorUnits)(Number(booking.amount_charged)) !== verify.amount) {
                res.sendStatus(200);
                return;
            }
            let newlyPaid = false;
            if (booking.payment_status === "refund_pending" && booking.late_payment_refund === true) {
                if (booking.refund_status === "failed") {
                    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET refund_status=:processing", ConditionExpression: "late_payment_refund=:yes AND refund_status=:failed", ExpressionAttributeValues: { ":processing": "processing", ":yes": true, ":failed": "failed" } }));
                    try {
                        await (0, paystack_js_1.paystack)("/refund", { transaction: booking.payment_reference, amount: (0, paystack_js_1.toMinorUnits)(Number(booking.amount_charged)), currency: "ZAR", customer_note: "Lesson slot expired before payment confirmation; full refund requested." });
                    }
                    catch (error) {
                        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET refund_status=:failed", ExpressionAttributeValues: { ":failed": "failed" } }));
                        throw error;
                    }
                }
                res.sendStatus(200);
                return;
            }
            if (booking.payment_status === "pending") {
                const expires = Math.floor((new Date(booking.time).getTime() + Number(booking.duration_hours) * 3600000 + 86400000) / 1000);
                const lockKeys = bookingSlotKeys(String(booking.instructor_id), new Date(booking.time), Number(booking.duration_hours) * 60);
                try {
                    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.TransactWriteCommand({ TransactItems: [
                            { Update: { TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET payment_status=:paid,#status=:confirmed,payment_success_at=:at,provider_transaction_id=:tid", ConditionExpression: "payment_status=:pending AND #status=:pendingStatus", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":paid": "paid", ":confirmed": "confirmed", ":pending": "pending", ":pendingStatus": "pending", ":at": new Date().toISOString(), ":tid": String(data.id ?? "") } } },
                            ...lockKeys.map(id => ({ Update: { TableName: dynamodb_js_1.tables.bookingLocks, Key: { id }, UpdateExpression: "SET expires_at=:expires", ConditionExpression: "booking_id=:booking AND expires_at > :now", ExpressionAttributeValues: { ":expires": expires, ":booking": bookingId, ":now": Math.floor(Date.now() / 1000) } } })),
                        ] }));
                    newlyPaid = true;
                }
                catch (error) {
                    if (error.name !== "TransactionCanceledException")
                        throw error;
                    const current = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId } }))).Item;
                    if (current?.payment_status === "pending") {
                        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET #status=:cancelled,payment_status=:refundPending,refund_status=:processing,refund_percent=:hundred,refund_amount=:amount,late_payment_refund=:yes,cancelled_at=:at", ConditionExpression: "payment_status=:pending", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":cancelled": "cancelled", ":refundPending": "refund_pending", ":processing": "processing", ":hundred": 100, ":amount": Number(booking.amount_charged), ":yes": true, ":at": new Date().toISOString(), ":pending": "pending" } }));
                        try {
                            await (0, paystack_js_1.paystack)("/refund", { transaction: booking.payment_reference, amount: (0, paystack_js_1.toMinorUnits)(Number(booking.amount_charged)), currency: "ZAR", customer_note: "Lesson slot expired before payment confirmation; full refund requested." });
                        }
                        catch (refundError) {
                            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET refund_status=:failed", ExpressionAttributeValues: { ":failed": "failed" } }));
                            throw refundError;
                        }
                        await releaseBookingLocks(booking);
                        const learner = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: booking.learner_id } }))).Item;
                        await sendEmail(String(learner?.email ?? ""), "Full refund requested · iDriveMzansi", "Your payment arrived after the instructor's time slot expired. We have requested a full refund from Paystack. Please choose another available lesson time.").catch(error => console.error("Late payment refund email failed", error));
                        res.sendStatus(200);
                        return;
                    }
                }
            }
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Key: { id: reference }, UpdateExpression: "SET #status=:status,provider_transaction_id=:tid,updated_at=:at", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":status": "success", ":tid": String(data.id ?? ""), ":at": new Date().toISOString() } }));
            const discount = Number(booking.discount_amount ?? 0);
            if (discount > 0 && booking.referral_credits_debited !== true)
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.TransactWriteCommand({ TransactItems: [
                        { Update: { TableName: dynamodb_js_1.tables.learners, Key: { user_id: booking.learner_id }, UpdateExpression: "SET referral_credits=referral_credits-:credit", ConditionExpression: "referral_credits >= :credit", ExpressionAttributeValues: { ":credit": discount } } },
                        { Update: { TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET referral_credits_debited=:yes", ConditionExpression: "payment_status=:paid AND attribute_not_exists(referral_credits_debited)", ExpressionAttributeValues: { ":yes": true, ":paid": "paid" } } },
                    ] })).catch(error => { if (error.name !== "TransactionCanceledException")
                    throw error; });
            if (newlyPaid) {
                const [learner, instructor] = await Promise.all([
                    dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: booking.learner_id } })),
                    dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: booking.instructor_id } })),
                ]);
                const lessonAt = new Date(booking.time).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
                const body = `Your iDriveMzansi lesson request is paid and awaiting instructor response. Lesson: ${lessonAt}. Lesson type: ${booking.lesson_type}. Pickup: ${booking.pickup_address}. Manage it in your iDriveMzansi lessons.`;
                await Promise.all([sendEmail(String(learner.Item?.email ?? ""), "Lesson request received · iDriveMzansi", body), sendEmail(String(instructor.Item?.email ?? ""), "New lesson request · iDriveMzansi", body)]).catch(error => console.error("Booking confirmation email failed", error));
                await Promise.all([notifyUser(String(booking.instructor_id), "booking_request", "New booking request", body, { booking_id: booking.id }), notifyUser(String(booking.learner_id), "booking_confirmed", "Booking confirmed", body, { booking_id: booking.id })]).catch(error => console.error("Booking push notification failed", error));
            }
            res.sendStatus(200);
            return;
        }
        const membershipInstructor = String(verify.metadata?.instructor_id ?? "");
        if (verify.metadata?.kind === "instructor_membership" && membershipInstructor) {
            const tier = String(verify.metadata.tier);
            if (tier === "weekly" || tier === "monthly") {
                const expiry = new Date();
                expiry.setDate(expiry.getDate() + (tier === "weekly" ? 7 : 30));
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: membershipInstructor }, UpdateExpression: "SET membership_tier=:premier,membership_plan=:tier,membership_expiry=:expiry,membership_payment_reference=:reference", ExpressionAttributeValues: { ":premier": "premier", ":tier": tier, ":expiry": expiry.toISOString(), ":reference": reference } }));
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Item: { id: reference, user_id: membershipInstructor, kind: "instructor_membership", tier, amount: (0, paystack_js_1.fromMinorUnits)(verify.amount), currency: "ZAR", status: "success", created_at: new Date().toISOString() } }));
            }
        }
        if (verify.metadata?.kind === "company_membership" && verify.metadata?.company_id) {
            const tier = String(verify.metadata.tier);
            if (tier === "weekly" || tier === "monthly") {
                const companyId = String(verify.metadata.company_id), expiry = new Date();
                expiry.setDate(expiry.getDate() + (tier === "weekly" ? 7 : 30));
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: companyId }, UpdateExpression: "SET membership_tier=:premier,membership_plan=:tier,membership_expiry=:expiry", ExpressionAttributeValues: { ":premier": "premier", ":tier": tier, ":expiry": expiry.toISOString() } }));
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Item: { id: reference, company_id: companyId, kind: "company_membership", tier, amount: (0, paystack_js_1.fromMinorUnits)(verify.amount), currency: "ZAR", status: "success", created_at: new Date().toISOString() } }));
            }
        }
        res.sendStatus(200);
    }
    catch (error) {
        next(error);
    }
});
async function instructorOrCompanyRecipient(instructor) {
    const company = instructor.company_id ? (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: instructor.company_id } }))).Item : undefined;
    const target = company ?? instructor;
    const targetKey = company ? "company_id" : "user_id";
    if (target.paystack_recipient_code)
        return { code: String(target.paystack_recipient_code), name: String(target.official_name ?? target.trading_as ?? target.full_name ?? "iDriveMzansi partner"), targetId: String(target.id ?? target.user_id), targetKey };
    const bankCode = target.bank_code;
    const accountNumber = String(target.account_number ?? "");
    const name = String(target.official_name ?? target.trading_as ?? target.full_name ?? "");
    if (!bankCode || !/^\d{6,20}$/.test(accountNumber) || !name)
        throw new Error("Payout bank account is not fully configured. Add a Paystack bank_code and valid account number.");
    const recipient = await (0, paystack_js_1.paystack)("/transferrecipient", { type: "basa", name, account_number: accountNumber, bank_code: bankCode, currency: "ZAR", metadata: { target_id: target.id ?? target.user_id, target_type: company ? "company" : "instructor" } });
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: company ? dynamodb_js_1.tables.companies : dynamodb_js_1.tables.instructors, Key: company ? { id: String(target.id) } : { user_id: String(target.user_id) }, UpdateExpression: "SET paystack_recipient_code=:code", ExpressionAttributeValues: { ":code": recipient.recipient_code } }));
    return { code: recipient.recipient_code, name, targetId: String(target.id ?? target.user_id), targetKey };
}
async function releaseBookingPayout(bookingId) {
    const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId } }))).Item;
    if (!booking || booking.payment_status !== "paid" || booking.status === "cancelled" || booking.payout_status === "completed" || booking.payout_status === "processing" || booking.payout_status === "company_pending" || booking.payout_status === "awaiting_otp")
        return;
    if (booking.instructor_marked_complete !== true || booking.learner_confirmed_complete !== true)
        return;
    const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: booking.instructor_id } }))).Item;
    if (!instructor)
        throw new Error("Instructor payout profile not found.");
    const payoutCompanyId = booking.company_id ?? instructor.company_id;
    if (payoutCompanyId) {
        const company = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: payoutCompanyId } }))).Item;
        if (!company)
            throw new Error("Linked company payout profile not found.");
        const payoutId = `booking-${bookingId}`;
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET payout_status=:pending,#status=:completed", ConditionExpression: "attribute_not_exists(payout_status) OR payout_status=:failed", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":pending": "company_pending", ":failed": "failed", ":completed": "completed" } }));
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.payouts, Item: { id: payoutId, instructor_id: booking.instructor_id, booking_id: bookingId, company_id: String(company.id), payee_id: String(company.id), payee_type: "company", amount: Number(booking.instructor_payout), platform_fee: Number(booking.platform_fee ?? 0), status: "company_pending", schedule: company.payout_schedule ?? "weekly", created_at: new Date().toISOString(), paystack_reference: `mdc-${bookingId}` } })).catch(error => { if (error.name !== "ConditionalCheckFailedException")
            throw error; });
        return;
    }
    const recipient = await instructorOrCompanyRecipient(instructor);
    const payoutId = `booking-${bookingId}`;
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET payout_status=:processing,#status=:completed", ConditionExpression: "attribute_not_exists(payout_status) OR payout_status=:failed", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":processing": "processing", ":failed": "failed", ":completed": "completed" } }));
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.payouts, Item: { id: payoutId, instructor_id: booking.instructor_id, booking_id: bookingId, payee_id: recipient.targetId, payee_type: instructor.company_id ? "company" : "instructor", amount: booking.instructor_payout, status: "processing", schedule: instructor.payout_schedule ?? "weekly", created_at: new Date().toISOString(), paystack_reference: `mdp-${bookingId}` } })).catch(error => { if (error.name !== "ConditionalCheckFailedException")
        throw error; });
    const reference = `mdp-${bookingId}`;
    let transfer;
    try {
        transfer = await (0, paystack_js_1.paystack)("/transfer", { source: "balance", amount: (0, paystack_js_1.toMinorUnits)(Number(booking.instructor_payout)), recipient: recipient.code, reason: `Driving lesson ${bookingId}`, reference, currency: "ZAR" });
    }
    catch (error) {
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET payout_status=:failed,payout_error=:error", ExpressionAttributeValues: { ":failed": "failed", ":error": "Transfer needs admin review" } }));
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: payoutId }, UpdateExpression: "SET #status=:failed,payout_error=:error", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":failed": "failed", ":error": "Transfer needs admin review" } }));
        throw error;
    }
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET transfer_code=:code,payout_reference=:reference,payout_initiated_at=:at", ExpressionAttributeValues: { ":code": transfer.transfer_code, ":reference": reference, ":at": new Date().toISOString() } }));
    if (transfer.status === "otp") {
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId }, UpdateExpression: "SET payout_status=:otp", ExpressionAttributeValues: { ":otp": "awaiting_otp" } }));
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: payoutId }, UpdateExpression: "SET #status=:otp,paystack_transfer_code=:code", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":otp": "awaiting_otp", ":code": transfer.transfer_code } }));
    }
    else
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: payoutId }, UpdateExpression: "SET paystack_transfer_code=:code", ExpressionAttributeValues: { ":code": transfer.transfer_code } }));
}
app.post("/v1/bookings/:id/respond", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const action = zod_1.z.object({ action: zod_1.z.enum(["accept", "decline"]) }).safeParse(req.body);
        if (!action.success) {
            res.status(400).json({ error: "Choose accept or decline." });
            return;
        }
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: req.params.id } }))).Item;
        if (!booking || booking.instructor_id !== req.auth.sub) {
            res.status(404).json({ error: "Booking not found." });
            return;
        }
        if (booking.payment_status !== "paid" || booking.status !== "confirmed" || booking.instructor_response !== "pending") {
            res.status(409).json({ error: "This booking is no longer awaiting your response." });
            return;
        }
        if (action.data.action === "accept") {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET instructor_response=:accepted,instructor_responded_at=:at,reminders=:reminders", ConditionExpression: "payment_status=:paid AND #status=:confirmed AND instructor_response=:pending", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":accepted": "accepted", ":pending": "pending", ":paid": "paid", ":confirmed": "confirmed", ":at": new Date().toISOString(), ":reminders": (booking.reminders ?? []).filter((reminder) => Date.parse(reminder.due_at) >= Date.now() - 300000) } }));
            const emailContent = await (0, modal_js_1.infer)("welcome-message", { profile: { role: "learner", city: booking.pickup_city }, onboarding_data: { event: "booking accepted", lesson_time: booking.time, lesson_type: booking.lesson_type, next_step: "Your instructor has accepted your lesson. Add the lesson to your calendar and contact them through your booking." } }).catch(() => ({ subject: "Your driving lesson is confirmed · iDriveMzansi", body: `Your instructor accepted your lesson on ${new Date(booking.time).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}. Pickup: ${booking.pickup_address}.` }));
            await notifyBookingParties(booking, emailContent.subject, emailContent.body).catch(error => console.error("Booking acceptance email failed", error));
            await notifyUser(String(booking.learner_id), "booking_confirmed", "Booking accepted", emailContent.body, { booking_id: booking.id });
            res.json({ status: "accepted" });
            return;
        }
        await (0, paystack_js_1.paystack)("/refund", { transaction: booking.payment_reference, amount: (0, paystack_js_1.toMinorUnits)(Number(booking.amount_charged)), currency: "ZAR", customer_note: "Instructor declined the lesson request." });
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET #status=:cancelled,instructor_response=:declined,payment_status=:refund_pending,refund_amount=:amount,refund_percent=:hundred,refund_status=:processing,cancelled_at=:at", ConditionExpression: "payment_status=:paid AND #status=:confirmed AND instructor_response=:pending", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":cancelled": "cancelled", ":declined": "declined", ":refund_pending": "refund_pending", ":amount": Number(booking.amount_charged), ":hundred": 100, ":processing": "processing", ":at": new Date().toISOString(), ":paid": "paid", ":confirmed": "confirmed", ":pending": "pending" } }));
        await releaseBookingLocks(booking);
        const declineEmail = await (0, modal_js_1.infer)("welcome-message", { profile: { role: "learner" }, onboarding_data: { event: "instructor declined lesson", lesson_time: booking.time, refund: "full refund requested", next_step: "Choose another instructor or lesson time." } }).catch(() => ({ subject: "Lesson request declined · iDriveMzansi", body: "The instructor cannot take this lesson. Your full refund has been requested from Paystack and will return to your original payment method." }));
        await notifyBookingParties(booking, declineEmail.subject, declineEmail.body).catch(error => console.error("Booking decline email failed", error));
        await notifyUser(String(booking.learner_id), "booking_cancelled", "Booking declined", declineEmail.body, { booking_id: booking.id });
        res.json({ status: "declined", refundAmount: Number(booking.amount_charged), currency: "ZAR" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/bookings/:id/reschedule", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), requireLearnerComplete, async (req, res, next) => {
    try {
        const parsed = zod_1.z.object({ startsAt: alignedDateTime }).safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: "Choose a valid lesson time." });
            return;
        }
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: req.params.id } }))).Item;
        if (!booking || booking.learner_id !== req.auth.sub) {
            res.status(404).json({ error: "Booking not found." });
            return;
        }
        if (booking.payment_status !== "paid" || booking.status !== "confirmed" || new Date(booking.time).getTime() - Date.now() < 24 * 3600000) {
            res.status(409).json({ error: "Rescheduling is available until 24 hours before the lesson." });
            return;
        }
        const startsAt = new Date(parsed.data.startsAt);
        const durationMinutes = Number(booking.duration_hours) * 60;
        const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: booking.instructor_id } }))).Item;
        if (!instructor || startsAt.getTime() < Date.now() + 3600000 || !isWithinInstructorAvailability(instructor, startsAt, durationMinutes)) {
            res.status(400).json({ error: "The new time is outside published availability." });
            return;
        }
        const oldKeys = bookingSlotKeys(booking.instructor_id, new Date(booking.time), durationMinutes);
        const newKeys = bookingSlotKeys(booking.instructor_id, startsAt, durationMinutes);
        const oldSet = new Set(oldKeys);
        const newSet = new Set(newKeys);
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.TransactWriteCommand({ TransactItems: [
                ...oldKeys.filter(key => !newSet.has(key)).map(id => ({ Delete: { TableName: dynamodb_js_1.tables.bookingLocks, Key: { id }, ConditionExpression: "booking_id=:booking", ExpressionAttributeValues: { ":booking": booking.id } } })),
                ...newKeys.filter(key => !oldSet.has(key)).map(id => ({ Put: { TableName: dynamodb_js_1.tables.bookingLocks, Item: { id, booking_id: booking.id, instructor_id: booking.instructor_id, starts_at: id.split("#")[1], expires_at: Math.floor((startsAt.getTime() + durationMinutes * 60000 + 86400000) / 1000) }, ConditionExpression: "attribute_not_exists(id) OR expires_at <= :now", ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) } } })),
                ...newKeys.filter(key => oldSet.has(key)).map(id => ({ Update: { TableName: dynamodb_js_1.tables.bookingLocks, Key: { id }, UpdateExpression: "SET expires_at=:expires", ConditionExpression: "booking_id=:booking", ExpressionAttributeValues: { ":expires": Math.floor((startsAt.getTime() + durationMinutes * 60000 + 86400000) / 1000), ":booking": booking.id } } })),
                { Update: { TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET #time=:time,#date=:date,reminders=:reminders REMOVE reminders_sent", ConditionExpression: "#status=:confirmed AND payment_status=:paid", ExpressionAttributeNames: { "#time": "time", "#date": "date", "#status": "status" }, ExpressionAttributeValues: { ":time": startsAt.toISOString(), ":date": startsAt.toISOString().slice(0, 10), ":confirmed": "confirmed", ":paid": "paid", ":reminders": [168, 72, 24, 2, 3, 1].map(hours => ({ hours_before: hours, due_at: new Date(startsAt.getTime() - hours * 3600000).toISOString(), sent: false })).filter(reminder => Date.parse(reminder.due_at) >= Date.now() - 300000) } } },
            ] }));
        const rescheduleEmail = await (0, modal_js_1.infer)("welcome-message", { profile: { role: "learner" }, onboarding_data: { event: "lesson rescheduled", lesson_time: startsAt.toISOString(), updated_pickup: booking.pickup_address, next_step: "Review the updated lesson time in your iDriveMzansi bookings." } }).catch(() => ({ subject: "Driving lesson rescheduled · iDriveMzansi", body: `Your lesson has been moved to ${startsAt.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}. Pickup: ${booking.pickup_address}.` }));
        await notifyBookingParties({ ...booking, time: startsAt.toISOString() }, rescheduleEmail.subject, rescheduleEmail.body).catch(error => console.error("Booking reschedule email failed", error));
        res.json({ status: "rescheduled", startsAt: startsAt.toISOString() });
    }
    catch (error) {
        if (error.name === "TransactionCanceledException") {
            res.status(409).json({ error: "The new time was just booked. Choose another slot." });
            return;
        }
        next(error);
    }
});
app.post("/v1/bookings/:id/complete", auth_js_1.requireAuth, async (req, res, next) => {
    try {
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: req.params.id } }))).Item;
        if (!booking) {
            res.status(404).json({ error: "Booking not found." });
            return;
        }
        if (req.auth.sub === booking.instructor_id && req.auth.role === "instructor") {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET instructor_marked_complete=:yes,instructor_completed_at=:at", ConditionExpression: "payment_status=:paid AND #status=:confirmed AND instructor_response=:accepted", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":yes": true, ":at": new Date().toISOString(), ":paid": "paid", ":confirmed": "confirmed", ":accepted": "accepted" } }));
        }
        else if (req.auth.sub === booking.learner_id && req.auth.role === "learner") {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET learner_confirmed_complete=:yes,learner_confirmed_at=:at", ConditionExpression: "payment_status=:paid AND #status=:confirmed AND instructor_marked_complete=:yes", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":yes": true, ":at": new Date().toISOString(), ":paid": "paid", ":confirmed": "confirmed" } }));
        }
        else {
            res.status(403).json({ error: "Only the booking's instructor and learner can confirm its completion." });
            return;
        }
        await releaseBookingPayout(booking.id);
        const updated = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id } }))).Item;
        if (updated?.status === "completed")
            await awardInstructorPoints(String(booking.instructor_id), "Lesson completed", 10, `lesson-completed-${booking.id}`);
        res.json({ status: "completion_recorded", payout: "released_if_both_parties_confirmed" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/bookings/:id/cancel", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), async (req, res, next) => {
    try {
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: req.params.id } }))).Item;
        if (!booking || booking.learner_id !== req.auth.sub) {
            res.status(404).json({ error: "Booking not found." });
            return;
        }
        if (booking.payment_status !== "paid" || booking.status !== "confirmed") {
            res.status(409).json({ error: "Only paid, confirmed bookings can be cancelled." });
            return;
        }
        const hoursUntilLesson = (new Date(booking.time).getTime() - Date.now()) / 3600000;
        const refundPercent = hoursUntilLesson >= 24 ? 100 : 0;
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET cancellation_requested_at=:at", ConditionExpression: "#status=:confirmed AND payment_status=:paid AND attribute_not_exists(cancellation_requested_at)", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":at": new Date().toISOString(), ":confirmed": "confirmed", ":paid": "paid" } }));
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET #status=:cancelled,refund_percent=:percent,refund_amount=:amount,refund_status=:refund,payment_status=:payment,cancelled_at=:at", ConditionExpression: "#status=:confirmed AND payment_status=:paid AND attribute_exists(cancellation_requested_at)", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":cancelled": "cancelled", ":percent": refundPercent, ":amount": refundPercent ? Number(booking.amount_charged) : 0, ":refund": refundPercent ? "processing" : "not_eligible", ":payment": refundPercent ? "refund_pending" : "paid", ":at": new Date().toISOString(), ":confirmed": "confirmed", ":paid": "paid" } }));
        if (refundPercent === 100) {
            try {
                await (0, paystack_js_1.paystack)("/refund", { transaction: booking.payment_reference, amount: (0, paystack_js_1.toMinorUnits)(Number(booking.amount_charged)), currency: "ZAR", customer_note: "Lesson cancelled at least 24 hours in advance." });
            }
            catch (error) {
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET #status=:confirmed,payment_status=:paid,refund_status=:failed REMOVE cancellation_requested_at,cancelled_at", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":confirmed": "confirmed", ":paid": "paid", ":failed": "failed" } }));
                throw error;
            }
        }
        await releaseBookingLocks(booking);
        const cancellationEmail = await (0, modal_js_1.infer)("welcome-message", { profile: { role: "learner" }, onboarding_data: { event: "lesson cancelled", lesson_time: booking.time, refund_percent: refundPercent, refund_amount: refundPercent ? Number(booking.amount_charged) : 0, next_step: refundPercent ? "Paystack is processing the refund to the original payment method." : "This cancellation is within 24 hours and is not refundable." } }).catch(() => ({ subject: "Driving lesson cancelled · iDriveMzansi", body: refundPercent ? "Your lesson has been cancelled and a full refund has been requested from Paystack." : "Your lesson has been cancelled. This cancellation is within 24 hours of the start time and is not refundable." }));
        await notifyBookingParties(booking, cancellationEmail.subject, cancellationEmail.body).catch(error => console.error("Booking cancellation email failed", error));
        await Promise.all([notifyUser(String(booking.learner_id), "booking_cancelled", "Booking cancelled", cancellationEmail.body, { booking_id: booking.id }), notifyUser(String(booking.instructor_id), "booking_cancelled", "Booking cancelled", cancellationEmail.body, { booking_id: booking.id })]);
        res.json({ status: "cancelled", refundPercent, refundAmount: refundPercent ? Number(booking.amount_charged) : 0, currency: "ZAR" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/internal/reminders/process", async (req, res, next) => {
    try {
        if (!process.env.EVENTBRIDGE_REMINDER_TOKEN || req.header("x-reminder-token") !== process.env.EVENTBRIDGE_REMINDER_TOKEN) {
            res.status(401).json({ error: "Unauthorized." });
            return;
        }
        const today = new Date();
        const dateFrom = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
        const dateTo = new Date(today.getTime() + 8 * 86400000).toISOString().slice(0, 10);
        const dueBookings = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.bookings, IndexName: "StatusBookings", KeyConditionExpression: "#status=:confirmed AND #date BETWEEN :from AND :to", ExpressionAttributeNames: { "#status": "status", "#date": "date" }, ExpressionAttributeValues: { ":confirmed": "confirmed", ":from": dateFrom, ":to": dateTo }, Limit: 1000 }));
        const bookings = (dueBookings.Items ?? []).filter(booking => booking.payment_status === "paid" && booking.instructor_response === "accepted");
        let delivered = 0;
        for (const booking of bookings) {
            for (const reminder of booking.reminders ?? []) {
                const key = `${booking.id}:${reminder.hours_before}`;
                if (reminder.sent || Date.parse(reminder.due_at) >= Date.now() - 300000 || (booking.reminders_sent ?? []).includes(key))
                    continue;
                const lessonAt = new Date(booking.time).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" });
                const message = `Reminder: your iDriveMzansi driving lesson is in ${reminder.hours_before} hour(s), at ${lessonAt}. Pickup: ${booking.pickup_address}.`;
                const [learner, instructor] = await Promise.all([
                    dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: booking.learner_id } })),
                    dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: booking.instructor_id } })),
                ]);
                const emails = [String(learner.Item?.email ?? ""), String(instructor.Item?.email ?? "")];
                await Promise.all(emails.map(email => sendEmail(email, "Upcoming driving lesson · iDriveMzansi", message)));
                if ([24, 2].includes(Number(reminder.hours_before)))
                    await Promise.all([notifyUser(String(booking.learner_id), "lesson_reminder", "Upcoming driving lesson", message, { booking_id: booking.id }), notifyUser(String(booking.instructor_id), "lesson_reminder", "Upcoming driving lesson", message, { booking_id: booking.id })]);
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET reminders_sent=list_append(if_not_exists(reminders_sent,:empty),:entry)", ConditionExpression: "#status=:confirmed AND payment_status=:paid AND (attribute_not_exists(reminders_sent) OR NOT contains(reminders_sent,:key))", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":empty": [], ":entry": [key], ":key": key, ":confirmed": "confirmed", ":paid": "paid" } }));
                delivered++;
            }
        }
        res.json({ delivered });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/instructors/me/membership", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ tier: zod_1.z.enum(["weekly", "monthly"]) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Choose weekly or monthly membership." });
            return;
        }
        const planCode = body.data.tier === "weekly" ? process.env.PAYSTACK_PLAN_WEEKLY : process.env.PAYSTACK_PLAN_MONTHLY;
        if (!planCode) {
            res.status(503).json({ error: "The requested membership plan is not configured." });
            return;
        }
        const user = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: req.auth.sub } }))).Item;
        if (!user?.email) {
            res.status(400).json({ error: "Account email is unavailable." });
            return;
        }
        const reference = `mdm-${req.auth.sub}-${(0, node_crypto_1.randomUUID)()}`;
        const checkout = await (0, paystack_js_1.paystack)("/transaction/initialize", { email: user.email, amount: "100", currency: "ZAR", plan: planCode, reference, callback_url: process.env.PAYSTACK_CALLBACK_URL, channels: [...paystack_js_1.PAYSTACK_CHANNELS], metadata: { kind: "instructor_membership", instructor_id: req.auth.sub, tier: body.data.tier } });
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Item: { id: checkout.reference, user_id: req.auth.sub, kind: "instructor_membership", tier: body.data.tier, amount: 0, currency: "ZAR", status: "pending", created_at: new Date().toISOString() } }));
        res.json({ authorizationUrl: checkout.authorization_url, reference: checkout.reference, tier: body.data.tier });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/learners/me/profile", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), async (req, res, next) => {
    try {
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: req.auth.sub } }));
        res.json({ item: result.Item ?? null });
    }
    catch (error) {
        next(error);
    }
});
const learnerProfileSchema = zod_1.z.object({
    full_name: zod_1.z.string().trim().min(2).max(120), dob: zod_1.z.string().date(), address: zod_1.z.string().trim().min(5).max(500),
    license_goal: zod_1.z.string().trim().min(2).max(100), transmission_preference: zod_1.z.enum(["manual", "automatic", "either"]),
    learning_style: zod_1.z.string().trim().min(2).max(500), emergency_contact: zod_1.z.object({ name: zod_1.z.string().min(2), phone: phoneSchema, relationship: zod_1.z.string().min(2) }),
    id_document_url: zod_1.z.string().min(5), learners_license_url: zod_1.z.string().min(5),
});
app.put("/v1/learners/me/profile", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), async (req, res, next) => {
    try {
        const parsed = learnerProfileSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json(schemaError("Complete every required learner profile field and upload both documents.", parsed.error));
            return;
        }
        const prefix = "private/" + req.auth.sub + "/";
        if (!parsed.data.id_document_url.startsWith(prefix) || !parsed.data.learners_license_url.startsWith(prefix)) {
            res.status(400).json({ error: "Document keys must belong to the signed-in learner." });
            return;
        }
        const bucket = process.env.S3_BUCKET;
        if (!bucket) {
            res.status(503).json({ error: "Private document storage is not configured." });
            return;
        }
        try {
            const files = await Promise.all([parsed.data.id_document_url, parsed.data.learners_license_url].map(Key => s3_js_1.s3.send(new client_s3_1.HeadObjectCommand({ Bucket: bucket, Key }))));
            if (files.some(file => !file.ContentLength || file.ContentLength > 12 * 1024 * 1024)) {
                res.status(400).json({ error: "Both documents must be uploaded and each must be no larger than 12 MB." });
                return;
            }
            if (files.some(file => !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.ContentType ?? ""))) {
                res.status(400).json({ error: "Unsupported document type." });
                return;
            }
        }
        catch {
            res.status(400).json({ error: "Upload both required documents before completing your profile." });
            return;
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({
            TableName: dynamodb_js_1.tables.learners, Key: { user_id: req.auth.sub },
            UpdateExpression: "SET full_name=:name,dob=:dob,address=:address,license_goal=:goal,transmission_preference=:transmission,learning_style=:learning,emergency_contact=:contact,id_document_url=:idDoc,learners_license_url=:licDoc,onboarding_complete=:complete,updated_at=:updated",
            ExpressionAttributeValues: { ":name": parsed.data.full_name, ":dob": parsed.data.dob, ":address": parsed.data.address, ":goal": parsed.data.license_goal, ":transmission": parsed.data.transmission_preference, ":learning": parsed.data.learning_style, ":contact": parsed.data.emergency_contact, ":idDoc": parsed.data.id_document_url, ":licDoc": parsed.data.learners_license_url, ":complete": true, ":updated": new Date().toISOString() },
        }));
        const learnerCode = "MDL" + (0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 8).toUpperCase();
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: req.auth.sub }, UpdateExpression: "SET referral_code=if_not_exists(referral_code,:code)", ExpressionAttributeValues: { ":code": learnerCode } }));
        await completeReferral(req.auth.sub);
        res.json({ status: "complete", next: "/learner" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/uploads/presign", auth_js_1.requireAuth, async (req, res, next) => {
    try {
        const parsed = zod_1.z.object({ category: zod_1.z.enum(["id-document", "learners-license", "instructor-document", "instructor-certificate", "driver-licence", "vehicle-roadworthy", "sa-id", "police-clearance", "vehicle-insurance", "professional-liability-insurance", "vehicle-photo", "profile-photo", "safety-report", "video-lesson"]), fileName: zod_1.z.string().min(1).max(180), contentType: zod_1.z.enum(["image/jpeg", "image/png", "application/pdf", "image/webp", "video/mp4", "video/webm"]), fileSizeBytes: zod_1.z.number().int().positive().optional() }).safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: "Unsupported upload. Use PDF, JPEG, PNG, or WebP." });
            return;
        }
        if (parsed.data.category === "video-lesson" && (!parsed.data.contentType.startsWith("video/") || !parsed.data.fileSizeBytes || parsed.data.fileSizeBytes > 150 * 1024 * 1024)) {
            res.status(400).json({ error: "Video uploads must be MP4 or WebM and no larger than 150 MB." });
            return;
        }
        if (parsed.data.category !== "video-lesson" && parsed.data.fileSizeBytes && parsed.data.fileSizeBytes > 12 * 1024 * 1024) {
            res.status(400).json({ error: "Documents and images must be no larger than 12 MB." });
            return;
        }
        const bucket = process.env.S3_BUCKET;
        if (!bucket) {
            res.status(503).json({ error: "Private document storage is not configured." });
            return;
        }
        const extension = parsed.data.fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
        const key = "private/" + req.auth.sub + "/" + parsed.data.category + "/" + (0, node_crypto_1.randomUUID)() + "." + extension;
        const command = new client_s3_1.PutObjectCommand({ Bucket: bucket, Key: key, ContentType: parsed.data.contentType, ...(parsed.data.fileSizeBytes ? { ContentLength: parsed.data.fileSizeBytes } : {}), ServerSideEncryption: "AES256" });
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3_js_1.s3, command, { expiresIn: 300 });
        res.json({ uploadUrl, objectKey: key, expiresIn: 300 });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/support/contact", auth_js_1.requireAuth, async (req, res, next) => { try {
    const body = zod_1.z.object({ subject: zod_1.z.string().trim().min(3).max(120), message: zod_1.z.string().trim().min(10).max(5000) }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: "Add a subject and a message of at least 10 characters." });
        return;
    }
    const user = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: req.auth.sub } }))).Item;
    const to = process.env.SUPPORT_EMAIL ?? process.env.ADMIN_EMAIL;
    if (!to) {
        res.status(503).json({ error: "Support email is not configured." });
        return;
    }
    await sendEmail(to, `Support request: ${body.data.subject}`, `From: ${user?.email ?? req.auth.sub}\nRole: ${req.auth.role}\n\n${body.data.message}`);
    res.status(202).json({ sent: true });
}
catch (error) {
    next(error);
} });
app.post("/v1/safety-reports", auth_js_1.requireAuth, async (req, res, next) => { try {
    const body = zod_1.z.object({ incident_type: zod_1.z.enum(["unsafe_driving", "harassment", "vehicle_safety", "fraud", "injury", "other"]), occurred_at: zod_1.z.string().datetime({ offset: true }), location: zod_1.z.string().trim().min(3).max(300), description: zod_1.z.string().trim().min(10).max(5000), photo_key: zod_1.z.string().optional() }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: "Complete the incident type, date, location, and description." });
        return;
    }
    if (body.data.photo_key && !body.data.photo_key.startsWith(`private/${req.auth.sub}/safety-report/`)) {
        res.status(403).json({ error: "Upload the photo to your private safety-report folder." });
        return;
    }
    const item = { id: (0, node_crypto_1.randomUUID)(), user_id: req.auth.sub, ...body.data, status: "new", created_at: new Date().toISOString() };
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.disputes, Item: { ...item, type: "safety_report", booking_id: `safety-${item.id}`, filed_by: req.auth.sub } }));
    if (process.env.ADMIN_EMAIL)
        await sendEmail(process.env.ADMIN_EMAIL, `Safety report · ${body.data.incident_type}`, `Report ${item.id}\n${body.data.occurred_at}\n${body.data.location}\n\n${body.data.description}\n${body.data.photo_key ?? "No photo attached"}`);
    res.status(201).json({ id: item.id, status: "received" });
}
catch (error) {
    next(error);
} });
app.post("/v1/instructors/me/video-lessons", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => { try {
    const body = zod_1.z.object({ title: zod_1.z.string().trim().min(3).max(120), description: zod_1.z.string().trim().max(2000).default(""), video_url: zod_1.z.string().min(1).max(2048), type: zod_1.z.enum(["live", "recorded"]), price: zod_1.z.number().min(0).max(5000), scheduled_at: zod_1.z.string().datetime({ offset: true }).optional(), join_url: zod_1.z.string().url().optional() }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: "Enter lesson details and a valid video or meeting link." });
        return;
    }
    if (body.data.type === "live" && (!body.data.scheduled_at || !body.data.join_url)) {
        res.status(400).json({ error: "Live lessons need a schedule and Zoom or Google Meet link." });
        return;
    }
    if (body.data.type === "recorded" && !body.data.video_url.startsWith(`private/${req.auth.sub}/video-lesson/`)) {
        res.status(403).json({ error: "Recorded lessons must use your private uploaded video." });
        return;
    }
    const item = { id: (0, node_crypto_1.randomUUID)(), instructor_id: req.auth.sub, ...body.data, enrollments: [], progress: {}, status: "active", created_at: new Date().toISOString() };
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.videoLessons, Item: item }));
    res.status(201).json({ item });
}
catch (error) {
    next(error);
} });
app.post("/v1/video-lessons/:id/progress", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), requireLearnerComplete, async (req, res, next) => { try {
    const body = zod_1.z.object({ progress_pct: zod_1.z.number().min(0).max(100) }).safeParse(req.body);
    const lesson = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.videoLessons, Key: { id: String(req.params.id) } }))).Item;
    if (!body.success || !lesson || (lesson.enrollments ?? []).includes(req.auth.sub) === false) {
        res.status(404).json({ error: "Enrolled video lesson not found." });
        return;
    }
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.videoLessons, Key: { id: lesson.id }, UpdateExpression: "SET progress.#learner=:progress", ExpressionAttributeNames: { "#learner": req.auth.sub }, ExpressionAttributeValues: { ":progress": body.data.progress_pct } }));
    res.json({ saved: true });
}
catch (error) {
    next(error);
} });
app.get("/v1/video-lessons/:id/play", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), requireLearnerComplete, async (req, res, next) => { try {
    const lesson = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.videoLessons, Key: { id: String(req.params.id) } }))).Item;
    if (!lesson || !(lesson.enrollments ?? []).includes(req.auth.sub)) {
        res.status(404).json({ error: "Enrol in this lesson before watching it." });
        return;
    }
    if (lesson.type === "live") {
        res.json({ url: lesson.join_url, scheduled_at: lesson.scheduled_at });
        return;
    }
    const key = String(lesson.video_url ?? "");
    if (!key.startsWith(`private/${lesson.instructor_id}/video-lesson/`)) {
        res.status(404).json({ error: "The private video asset could not be found." });
        return;
    }
    const bucket = process.env.S3_BUCKET;
    if (!bucket) {
        res.status(503).json({ error: "Private video storage is not configured." });
        return;
    }
    const url = await (0, s3_request_presigner_1.getSignedUrl)(s3_js_1.s3, new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 1800 });
    res.json({ url, expires_in: 1800 });
}
catch (error) {
    next(error);
} });
app.post("/v1/instructors/me/k53-assessment/start", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), async (req, res, next) => {
    try {
        const generated = await (0, modal_js_1.infer)("k53-questions", { test_type: "instructor_k53_knowledge", difficulty: "medium", count: 10 });
        const valid = ai_contracts_js_1.aiOutputs["k53-questions"].safeParse(generated);
        if (!valid.success || !Array.isArray(valid.data) || valid.data.length !== 10) {
            res.status(502).json({ error: "Could not prepare the K53 assessment." });
            return;
        }
        const id = (0, node_crypto_1.randomUUID)();
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.k53TestResults, Item: { id, learner_id: req.auth.sub, user_type: "instructor", test_type: "instructor_k53_knowledge", status: "pending", questions: valid.data, created_at: new Date().toISOString(), expires_at: Date.now() + 2 * 60 * 60 * 1000 } }));
        res.status(201).json({ assessment_id: id, questions: valid.data.map(({ question, options, category }) => ({ question, options, category })) });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/instructors/me/k53-assessment/:id/submit", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), async (req, res, next) => {
    try {
        const body = zod_1.z.object({ answers: zod_1.z.array(zod_1.z.number().int().min(0).max(3)).length(10) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Select one answer for each of the 10 questions." });
            return;
        }
        const result = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.k53TestResults, Key: { id: req.params.id } }))).Item;
        if (!result || result.user_type !== "instructor" || result.learner_id !== req.auth.sub) {
            res.status(404).json({ error: "Assessment not found." });
            return;
        }
        if (result.status !== "pending" || Number(result.expires_at) < Date.now()) {
            res.status(409).json({ error: "This assessment has expired or has already been submitted." });
            return;
        }
        const questions = result.questions;
        const correct = questions.reduce((sum, question, index) => sum + (question.correct_index === body.data.answers[index] ? 1 : 0), 0);
        const score = correct * 10;
        const passed = score >= 80;
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.k53TestResults, Key: { id: req.params.id }, UpdateExpression: "SET #status=:status,score=:score,#pass=:passed,answers=:answers,completed_at=:now", ConditionExpression: "#status=:pending", ExpressionAttributeNames: { "#status": "status", "#pass": "pass" }, ExpressionAttributeValues: { ":status": "completed", ":pending": "pending", ":score": score, ":passed": passed, ":answers": body.data.answers, ":now": new Date().toISOString() } }));
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub }, UpdateExpression: "SET k53_assessment_passed=:passed,k53_assessment_score=:score,k53_assessment_id=:id", ExpressionAttributeValues: { ":passed": passed, ":score": score, ":id": req.params.id } }));
        res.json({ score, passed, correct_answers: correct, total_questions: 10, required_score: 80, next: passed ? "review" : "retake" });
    }
    catch (error) {
        next(error);
    }
});
function schemaError(fallback, error) {
    const flat = error.flatten();
    const messages = Object.values(flat.fieldErrors).flat().filter((message) => typeof message === "string");
    return { error: messages.length ? `${fallback} ${messages.slice(0, 3).join(" · ")}` : fallback, details: flat };
}
const instructorProfileFields = zod_1.z.object({
    full_name: zod_1.z.string().trim().min(2).max(120).optional(), email: zod_1.z.string().email().optional(), phone: saPhoneSchema.optional(),
    bio: zod_1.z.string().max(2000).optional(), experience_years: zod_1.z.number().min(0).max(80).optional(), languages: zod_1.z.array(zod_1.z.string().max(50)).max(20).optional(), city: zod_1.z.string().max(100).optional(),
    primary_approach: zod_1.z.string().max(200).optional(), secondary_approaches: zod_1.z.array(zod_1.z.string().max(200)).max(20).optional(), philosophy: zod_1.z.string().max(2000).optional(), student_types: zod_1.z.array(zod_1.z.string().max(100)).max(30).optional(), unique_techniques: zod_1.z.array(zod_1.z.string().max(300)).max(30).optional(),
    suburbs_covered: zod_1.z.array(zod_1.z.string().max(100)).max(50).optional(), lesson_types: zod_1.z.array(zod_1.z.enum(["A1", "A", "B", "EB", "C1", "C", "EC1", "EC", "K53 Test Prep", "Defensive Driving", "Traffic Department Pass Out Test (3h)"])).max(30).optional(),
    transmission: zod_1.z.preprocess(value => (value === "" || value === null ? undefined : value), zod_1.z.enum(["manual", "automatic", "both"]).optional()), vehicle_make: zod_1.z.string().max(100).optional(), vehicle_model: zod_1.z.string().max(100).optional(),
    vehicle_photos: zod_1.z.array(zod_1.z.string()).max(10).optional(), hourly_rate: zod_1.z.number().min(0).max(10000).optional(), bank_name: zod_1.z.string().max(100).optional(), bank_code: zod_1.z.string().max(20).optional(),
    account_number: zod_1.z.string().max(50).optional(), teaching_style: zod_1.z.record(zod_1.z.unknown()).optional(), specializations: zod_1.z.array(zod_1.z.string()).optional(),
    certifications: zod_1.z.array(zod_1.z.string()).optional(), social_handles: zod_1.z.record(zod_1.z.string()).optional(),
    video_intro_url: zod_1.z.string().optional(), profile_photo_url: zod_1.z.string().optional(),
    lesson_packages: zod_1.z.array(zod_1.z.object({ name: zod_1.z.string().trim().min(2).max(60), lesson_count: zod_1.z.number().int().min(1).max(100), price: zod_1.z.number().min(0).max(100000), lesson_type: zod_1.z.string().trim().max(60).optional() })).max(20).optional(),
});
// instructors GSIs (infra/dynamodb/create_tables.py): CityListings on city, VerificationQueue on verification_status, ReferralCodeLookup on referral_code.
// DynamoDB rejects an empty string in a key attribute, so an empty value on one of these means "leave it as it is", not "clear it".
const instructorIndexKeys = new Set(["city", "verification_status", "referral_code"]);
const writableProfileFields = (entries) => entries.filter(([key, value]) => value !== undefined && !(value === "" && instructorIndexKeys.has(key)));
app.put("/v1/instructors/me/onboarding", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), async (req, res, next) => {
    try {
        const body = zod_1.z.object({ step: zod_1.z.number().int().min(1).max(9), complete: zod_1.z.boolean().default(false), terms_accepted: zod_1.z.boolean().optional(), profile: instructorProfileFields }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json(schemaError("Invalid onboarding details.", body.error));
            return;
        }
        const existing = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub } }))).Item ?? {};
        const candidate = { ...existing, ...body.data.profile };
        let welcome;
        if (body.data.complete) {
            if (body.data.terms_accepted !== true) {
                res.status(400).json({ error: "Accept the Terms of Use before submitting." });
                return;
            }
            const documents = candidate.documents ?? {};
            const checks = candidate.document_verification ?? {};
            const requiredDocs = ["instructor_certificate", "driver_licence", "vehicle_roadworthy", "sa_id", "police_clearance", "vehicle_insurance", "professional_liability_insurance"];
            const missingDocs = requiredDocs.filter(key => !documents[key] || !checks[key] || checks[key].recommendation === "reject");
            const suburbs = Array.isArray(candidate.suburbs_covered) ? candidate.suburbs_covered : [];
            const liability = checks.professional_liability_insurance?.extracted_data ?? {};
            const coverRaw = liability.coverage_amount ?? liability.coverage_limit_zar ?? 0;
            const cover = typeof coverRaw === "number" ? coverRaw : Number(String(coverRaw).replace(/[^\d.]/g, ""));
            const missing = ["full_name", "phone", "bio", "experience_years", "city", "primary_approach", "philosophy", "vehicle_make", "vehicle_model", "transmission", "hourly_rate"].filter(key => candidate[key] === undefined || candidate[key] === null || candidate[key] === "");
            if (Number(candidate.hourly_rate) <= 0)
                missing.push("positive hourly_rate");
            const missingFields = [...missing, ...(!candidate.languages?.length ? ["languages"] : []), ...(!candidate.secondary_approaches?.length ? ["secondary_approaches"] : []), ...(!candidate.student_types?.length ? ["student_types"] : []), ...(!candidate.unique_techniques?.length ? ["unique_techniques"] : []), ...(!candidate.lesson_types?.length ? ["lesson_types"] : []), ...(suburbs.length < 3 ? ["three service suburbs"] : []), ...missingDocs.map((key) => `verified document: ${key}`), ...(candidate.k53_assessment_passed !== true ? ["passed K53 instructor assessment"] : []), ...(cover < 1_000_000 ? ["professional liability cover of at least R1,000,000"] : [])];
            if (missingFields.length) {
                res.status(400).json({ error: "Finish all required steps before submission.", missing: missingFields });
                return;
            }
            const objectKeys = requiredDocs.map(key => String(documents[key]));
            try {
                const fileHeads = await Promise.all(objectKeys.map(Key => s3_js_1.s3.send(new client_s3_1.HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key }))));
                if (fileHeads.some(file => !file.ContentLength || file.ContentLength > 12 * 1024 * 1024)) {
                    res.status(400).json({ error: "Each required instructor document must be uploaded and no larger than 12 MB." });
                    return;
                }
            }
            catch {
                res.status(400).json({ error: "Upload all seven instructor documents before submitting." });
                return;
            }
            const completeness = 100;
            const welcomeProfile = { full_name: candidate.full_name, city: candidate.city, experience_years: candidate.experience_years, lesson_types: candidate.lesson_types, teaching_style: candidate.teaching_style };
            const generated = await (0, modal_js_1.infer)("welcome-message", { instructor_profile: welcomeProfile, onboarding_data: { completeness_score: completeness, status: "pending verification", next_step: "Watch for your instructor profile review result by email." } });
            const sender = process.env.SES_FROM_EMAIL;
            const email = req.auth.email ?? candidate.email;
            if (!sender || !email) {
                res.status(503).json({ error: "Welcome email delivery is not configured. Set SES_FROM_EMAIL and verify the sender in AWS SES." });
                return;
            }
            await ses.send(new client_sesv2_1.SendEmailCommand({ FromEmailAddress: sender, Destination: { ToAddresses: [email] }, Content: { Simple: { Subject: { Data: generated.subject, Charset: "UTF-8" }, Body: { Text: { Data: generated.body, Charset: "UTF-8" } } } } }));
            welcome = generated;
        }
        const attrs = writableProfileFields(Object.entries(body.data.profile));
        const names = { "#step": "onboarding_step", "#commission": "commission_rate", "#status": "verification_status", "#profile": "profile_updated_at" };
        const now = new Date().toISOString();
        // Never move onboarding_step backwards: editing an earlier step must leave the wizard reopening at the furthest step reached.
        const reachedStep = Math.min(9, Math.max(Number(existing.onboarding_step ?? 0) || 0, body.data.step + 1));
        const values = { ":step": body.data.complete ? 9 : reachedStep, ":commission": 15, ":status": "pending", ":now": now };
        // A partial save must never clear onboarding_complete: an approved instructor editing an earlier step keeps their verified state (requireInstructorComplete depends on it).
        const sets = ["#step=:step", ...(body.data.complete ? ["#complete=:complete"] : []), "#commission=if_not_exists(#commission,:commission)", "#status=if_not_exists(#status,:status)", "#profile=:now"];
        if (body.data.complete) {
            names["#complete"] = "onboarding_complete";
            values[":complete"] = true;
        }
        if (body.data.complete) {
            names["#terms"] = "terms_accepted_at";
            values[":terms"] = now;
            values[":welcome"] = welcome;
            sets.push("#terms=:terms", "profile_completeness=:score", "submitted_at=:now", "welcome_email_sent_at=:now", "welcome_message=:welcome");
            values[":score"] = 100;
        }
        attrs.forEach(([key, value], i) => { names["#f" + i] = key; values[":v" + i] = value; sets.push("#f" + i + "=:v" + i); });
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub }, UpdateExpression: "SET " + sets.join(","), ExpressionAttributeNames: names, ExpressionAttributeValues: values }));
        if (body.data.complete) {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructorStats, Key: { id: req.auth.sub }, UpdateExpression: "SET instructor_id=:instructor,total_lessons=if_not_exists(total_lessons,:zero),total_earnings=if_not_exists(total_earnings,:zero),avg_rating=if_not_exists(avg_rating,:zero),booking_completion_rate=if_not_exists(booking_completion_rate,:zero)", ExpressionAttributeValues: { ":instructor": req.auth.sub, ":zero": 0 } }));
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.achievements, Key: { id: req.auth.sub + "-onboarding" }, UpdateExpression: "SET instructor_id=:instructor,badge_name=:badge,points=if_not_exists(points,:points),unlocked_at=if_not_exists(unlocked_at,:now)", ExpressionAttributeValues: { ":instructor": req.auth.sub, ":badge": "Onboarding complete", ":points": 100, ":now": now } }));
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.notifications, Item: { id: (0, node_crypto_1.randomUUID)(), user_id: req.auth.sub, type: "welcome", title: welcome.subject, body: welcome.body, read: false, priority: "normal", created_at: now } }));
            const instructorCode = "MDI" + (0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 8).toUpperCase();
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub }, UpdateExpression: "SET referral_code=if_not_exists(referral_code,:code)", ExpressionAttributeValues: { ":code": instructorCode } }));
            await completeReferral(req.auth.sub);
            await awardInstructorPoints(req.auth.sub, "Instructor onboarding complete", 100, "onboarding");
            const admins = (await scanAll(dynamodb_js_1.tables.users)).filter(user => user.user_type === "admin");
            await Promise.all(admins.map(admin => notifyUser(String(admin.id), "verification_request", "Instructor verification requested", `${candidate.full_name ?? "An instructor"} submitted documents and their profile for review.`, { instructor_id: req.auth.sub })));
            if (process.env.ADMIN_EMAIL)
                await sendEmail(process.env.ADMIN_EMAIL, "Instructor verification requested · iDriveMzansi", `${candidate.full_name ?? "An instructor"} has completed onboarding and is ready for verification.`).catch(error => console.error("Verification request email failed", error));
        }
        res.json({ status: body.data.complete ? "submitted_for_review" : "saved", profile_completeness: body.data.complete ? 100 : undefined, welcome, next: body.data.complete ? "/instructor/onboarding?step=9" : "/instructor/onboarding?step=" + Math.min(body.data.step + 1, 9) });
    }
    catch (error) {
        next(error);
    }
});
// An approved instructor may deliberately restart onboarding so a material profile change is re-checked: the wizard reopens at step 1,
// the profile leaves the marketplace, and the next submission re-enters the admin review queue.
app.post("/v1/instructors/me/onboarding/restart", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), async (req, res, next) => {
    try {
        const existing = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub } }))).Item;
        if (!existing) {
            res.status(404).json({ error: "Instructor profile not found." });
            return;
        }
        if (existing.verification_status !== "active") {
            res.status(409).json({ error: "Only an approved instructor can restart onboarding." });
            return;
        }
        // Resubmission writes verification_status with if_not_exists(...,"pending"), so it has to leave "active" here or the new submission would never be reviewed again.
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({
            TableName: dynamodb_js_1.tables.instructors,
            Key: { user_id: req.auth.sub },
            UpdateExpression: "SET onboarding_step=:step, onboarding_complete=:complete, verification_status=:pending, onboarding_restarted_at=:now",
            ExpressionAttributeValues: { ":step": 1, ":complete": false, ":pending": "pending", ":now": new Date().toISOString() },
        }));
        res.json({ status: "restarted", next: "/instructor/onboarding" });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/instructors/me/profile", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), async (req, res, next) => {
    try {
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub } }));
        const { commission_rate: _commissionRate, ...profile } = result.Item ?? {};
        res.json({ item: profile });
    }
    catch (error) {
        next(error);
    }
});
app.put("/v1/instructors/me/profile", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const body = instructorProfileFields.partial().safeParse(req.body);
        if (!body.success || Object.keys(body.data ?? {}).length === 0) {
            res.status(400).json(body.success ? { error: "Provide valid instructor profile fields." } : schemaError("Provide valid instructor profile fields.", body.error));
            return;
        }
        const names = { "#updated": "profile_updated_at" };
        const values = { ":updated": new Date().toISOString() };
        const sets = ["#updated=:updated"];
        writableProfileFields(Object.entries(body.data)).forEach(([key, value], index) => { names["#f" + index] = key; values[":v" + index] = value; sets.push("#f" + index + "=:v" + index); });
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub }, UpdateExpression: "SET " + sets.join(","), ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: "ALL_NEW" }));
        res.json({ item: result.Attributes });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/learners/me/dashboard", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), requireLearnerComplete, async (req, res, next) => {
    try {
        const learnerId = req.auth.sub;
        const [bookings, progressRows, k53Rows, plans, logbooks, instructors, reviews, videos, referrals, slots, learnerResult] = await Promise.all([
            dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.bookings, IndexName: "LearnerBookings", KeyConditionExpression: "learner_id=:id", ExpressionAttributeValues: { ":id": learnerId }, Limit: 100 })),
            dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.studentProgress, IndexName: "LearnerProgress", KeyConditionExpression: "learner_id=:id", ExpressionAttributeValues: { ":id": learnerId }, Limit: 20 })).catch(() => ({ Items: [] })),
            scanAll(dynamodb_js_1.tables.k53TestResults).then(items => items.filter(item => item.learner_id === learnerId)),
            scanAll(dynamodb_js_1.tables.lessonPlans).then(items => items.filter(item => item.learner_id === learnerId)),
            scanAll(dynamodb_js_1.tables.driveLogbook).then(items => items.filter(item => item.learner_id === learnerId)),
            scanAll(dynamodb_js_1.tables.instructors).then(items => items.filter(item => item.verification_status === "active").map(publicInstructor)),
            scanAll(dynamodb_js_1.tables.reviews).then(items => items.filter(item => item.learner_id === learnerId)),
            scanAll(dynamodb_js_1.tables.videoLessons).then(items => items.filter(item => item.status !== "draft")),
            scanAll(dynamodb_js_1.tables.referrals).then(items => items.filter(item => item.referrer_id === learnerId || item.referred_id === learnerId)),
            scanAll(dynamodb_js_1.tables.enatisSlots),
            dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: learnerId } })),
        ]);
        const rows = bookings.Items ?? [];
        const profile = learnerResult.Item ?? {};
        const completed = rows.filter(row => row.status === "completed");
        const upcoming = rows.filter(row => ["pending", "confirmed"].includes(String(row.status)) && new Date(row.time).getTime() > Date.now()).sort((a, b) => String(a.time).localeCompare(String(b.time)));
        const byId = new Map(instructors.map((item) => [String(item.user_id), item]));
        const nearby = instructors.filter(item => !profile.city || String(item.city ?? "").toLowerCase() === String(profile.city).toLowerCase()).slice(0, 30);
        const referrerCode = profile.referral_code ?? learnerId.slice(0, 8).toUpperCase();
        res.json({ bookings: rows, upcoming, completed, progress: progressRows.Items ?? [], k53_results: k53Rows.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))), lesson_plans: plans, logbooks, instructors: nearby, favourites: (profile.favourite_instructors ?? []).map((id) => byId.get(String(id))).filter(Boolean), reviews, videos: videos.map(item => { const enrolled = (item.enrollments ?? []).includes(learnerId); return { ...item, enrolled, video_url: enrolled ? item.video_url : undefined, join_url: enrolled ? item.join_url : undefined }; }), referrals, referral_code: referrerCode, referral_credits: Number(profile.referral_credits ?? 0), enatis_slots: slots.filter(item => item.status === "available" && slotMatchesPreferences(item, profile.enatis_preferences ?? [])), enatis_expired: slots.filter(item => item.status === "expired" && slotMatchesPreferences(item, profile.enatis_preferences ?? []) && String(item.available_date ?? "") >= saDaysAgo(14)).sort((a, b) => String(b.available_date).localeCompare(String(a.available_date))).slice(0, 8), enatis_preferences: profile.enatis_preferences ?? [], stats: { upcoming: upcoming.length, completed: completed.length, hours: completed.reduce((sum, item) => sum + Number(item.duration_hours ?? 0), 0) } });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/learners/me/actions", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner"), requireLearnerComplete, async (req, res, next) => {
    try {
        const learnerId = req.auth.sub;
        const body = zod_1.z.discriminatedUnion("action", [
            zod_1.z.object({ action: zod_1.z.literal("dispute"), booking_id: zod_1.z.string().min(1), type: zod_1.z.string().min(2).max(80), description: zod_1.z.string().min(10).max(2000) }),
            zod_1.z.object({ action: zod_1.z.literal("favourite"), instructor_id: zod_1.z.string().min(1), favourite: zod_1.z.boolean() }),
            zod_1.z.object({ action: zod_1.z.literal("enatis_preferences"), preferences: zod_1.z.array(zod_1.z.object({ province: zod_1.z.string().min(2), test_centre: zod_1.z.string().optional() })).max(20) }),
            zod_1.z.object({ action: zod_1.z.literal("enatis_check") }),
            zod_1.z.object({ action: zod_1.z.literal("enrol_video"), video_id: zod_1.z.string().min(1) }),
            zod_1.z.object({ action: zod_1.z.literal("logbook_sign"), logbook_id: zod_1.z.string().min(1), skill_name: zod_1.z.string().min(1) }),
            zod_1.z.object({ action: zod_1.z.literal("logbook_add_skill"), booking_id: zod_1.z.string().min(1), skill_name: zod_1.z.string().min(1), category: zod_1.z.string().min(1) }),
        ]).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Invalid learner action.", details: body.error.flatten() });
            return;
        }
        const actionData = body.data;
        if (body.data.action === "dispute") {
            const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: body.data.booking_id } }))).Item;
            if (!booking || booking.learner_id !== learnerId) {
                res.status(404).json({ error: "Booking not found." });
                return;
            }
            const id = (0, node_crypto_1.randomUUID)();
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.disputes, Item: { id, booking_id: booking.id, filed_by: learnerId, type: body.data.type, description: body.data.description, status: "open", refund_amount: 0, admin_notes: "", created_at: new Date().toISOString() }, ConditionExpression: "attribute_not_exists(id)" }));
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET dispute_id=:id", ExpressionAttributeValues: { ":id": id } }));
            res.status(201).json({ id });
            return;
        }
        if (body.data.action === "favourite") {
            const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: actionData.instructor_id } }))).Item;
            if (!instructor || instructor.verification_status !== "active") {
                res.status(404).json({ error: "Instructor not found." });
                return;
            }
            const profile = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: learnerId } }))).Item ?? {};
            const ids = profile.favourite_instructors ?? [];
            const nextIds = actionData.favourite ? [...new Set([...ids, actionData.instructor_id])] : ids.filter(id => id !== actionData.instructor_id);
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: learnerId }, UpdateExpression: "SET favourite_instructors=:ids", ExpressionAttributeValues: { ":ids": nextIds } }));
            res.json({ favourite_instructors: nextIds });
            return;
        }
        if (body.data.action === "enatis_preferences") {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: learnerId }, UpdateExpression: "SET enatis_preferences=:prefs", ExpressionAttributeValues: { ":prefs": actionData.preferences } }));
            res.json({ saved: true });
            return;
        }
        if (body.data.action === "enatis_check") {
            const profile = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: learnerId } }))).Item ?? {};
            const preferences = profile.enatis_preferences ?? [];
            const slots = (await scanAll(dynamodb_js_1.tables.enatisSlots)).filter(slot => slot.status === "available" && slotMatchesPreferences(slot, preferences));
            if (slots.length)
                await notifyUser(learnerId, "enatis_slot", "eNaTIS test slot available", `${slots.length} matching driving test slot(s) are available. Open your eNaTIS Monitor to review them.`);
            let analysis = "Your saved province and test-centre preferences were checked against the latest slots available in iDriveMzansi.";
            try {
                const ai = await (0, modal_js_1.infer)("chatbot", { message: `Summarise matching South African eNaTIS driving test availability for these preferences and slots. Be clear that slots may change. Preferences: ${JSON.stringify(preferences)}. Slots: ${JSON.stringify(slots.slice(0, 20))}`, user_context: { role: "learner" }, page_context: { page: "enatis-monitor" }, chat_history: [] });
                analysis = ai.reply;
            }
            catch { }
            res.json({ slots, analysis, notified: slots.length > 0 });
            return;
        }
        if (body.data.action === "enrol_video") {
            const video = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.videoLessons, Key: { id: actionData.video_id } }))).Item;
            if (!video || video.status === "draft") {
                res.status(404).json({ error: "Video lesson not found." });
                return;
            }
            if (!(video.enrollments ?? []).includes(learnerId))
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.videoLessons, Key: { id: video.id }, UpdateExpression: "SET enrollments=list_append(if_not_exists(enrollments,:empty),:learner)", ConditionExpression: "attribute_not_exists(enrollments) OR NOT contains(enrollments,:id)", ExpressionAttributeValues: { ":empty": [], ":learner": [learnerId], ":id": learnerId } }));
            res.json({ enrolled: true });
            return;
        }
        if (body.data.action === "logbook_add_skill") {
            const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: actionData.booking_id } }))).Item;
            if (!booking || booking.learner_id !== learnerId || !["confirmed", "completed"].includes(booking.status)) {
                res.status(404).json({ error: "An active lesson booking is required to add a logbook skill." });
                return;
            }
            const id = `${booking.id}-logbook`;
            const existing = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.driveLogbook, Key: { id } }))).Item;
            const skill = { name: actionData.skill_name, category: actionData.category, signed_by_instructor: false, signed_by_learner: true, date: new Date().toISOString() };
            const skillRows = existing?.skills ?? [];
            if (!skillRows.some((row) => row.name === skill.name))
                skillRows.push(skill);
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.driveLogbook, Item: { id, learner_id: learnerId, instructor_id: booking.instructor_id, booking_id: booking.id, skills: skillRows, updated_at: new Date().toISOString() } }));
            res.json({ id, skills: skillRows });
            return;
        }
        const logbook = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.driveLogbook, Key: { id: actionData.logbook_id } }))).Item;
        if (!logbook || logbook.learner_id !== learnerId) {
            res.status(404).json({ error: "Logbook entry not found." });
            return;
        }
        const skills = (logbook.skills ?? []).map((skill) => skill.name === actionData.skill_name ? { ...skill, signed_by_learner: true, learner_signed_at: new Date().toISOString() } : skill);
        if (!skills.some((skill) => skill.name === actionData.skill_name)) {
            res.status(404).json({ error: "Skill not found." });
            return;
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.driveLogbook, Key: { id: logbook.id }, UpdateExpression: "SET skills=:skills", ExpressionAttributeValues: { ":skills": skills } }));
        res.json({ skills });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/instructors/me/logbook/:id/sign", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ skill_name: zod_1.z.string().min(1) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Choose a logbook skill to sign." });
            return;
        }
        const item = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.driveLogbook, Key: { id: req.params.id } }))).Item;
        if (!item || item.instructor_id !== req.auth.sub) {
            res.status(404).json({ error: "Logbook entry not found." });
            return;
        }
        const skills = (item.skills ?? []).map((skill) => skill.name === body.data.skill_name ? { ...skill, signed_by_instructor: true, instructor_signed_at: new Date().toISOString() } : skill);
        if (!skills.some((skill) => skill.name === body.data.skill_name)) {
            res.status(404).json({ error: "Skill not found." });
            return;
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.driveLogbook, Key: { id: item.id }, UpdateExpression: "SET skills=:skills", ExpressionAttributeValues: { ":skills": skills } }));
        res.json({ skills });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/instructors/me/dashboard", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const instructorId = req.auth.sub;
        const [bookingResult, payoutRows, planRows, progressRows, achievementRows, campaignRows, referralRows, reviewRows, learnerFeedbackRows, allMessages, statsResult, profileResult] = await Promise.all([
            dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.bookings, IndexName: "InstructorBookings", KeyConditionExpression: "instructor_id=:id", ExpressionAttributeValues: { ":id": instructorId }, Limit: 200 })),
            dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.payouts, IndexName: "InstructorPayouts", KeyConditionExpression: "instructor_id=:id", ExpressionAttributeValues: { ":id": instructorId }, Limit: 100 })).catch(() => ({ Items: [] })),
            dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.lessonPlans, IndexName: "InstructorLessonPlans", KeyConditionExpression: "instructor_id=:id", ExpressionAttributeValues: { ":id": instructorId }, Limit: 100 })).catch(() => ({ Items: [] })),
            dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.studentProgress, IndexName: "InstructorProgress", KeyConditionExpression: "instructor_id=:id", ExpressionAttributeValues: { ":id": instructorId }, Limit: 100 })).catch(() => ({ Items: [] })),
            dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.achievements, IndexName: "InstructorAchievements", KeyConditionExpression: "instructor_id=:id", ExpressionAttributeValues: { ":id": instructorId }, Limit: 100 })).catch(() => ({ Items: [] })),
            scanAll(dynamodb_js_1.tables.adCampaigns).then(rows => rows.filter(item => item.instructor_id === instructorId)),
            scanAll(dynamodb_js_1.tables.referrals).then(rows => rows.filter(item => item.referrer_id === instructorId || item.referred_id === instructorId)),
            scanAll(dynamodb_js_1.tables.reviews).then(rows => rows.filter(item => item.instructor_id === instructorId)),
            scanAll(dynamodb_js_1.tables.learnerReviews).then(rows => rows.filter(item => item.instructor_id === instructorId)),
            scanAll(dynamodb_js_1.tables.messages).then(rows => rows.filter(item => item.sender_id === instructorId || item.receiver_id === instructorId)),
            dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructorStats, Key: { id: instructorId } })),
            dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: instructorId } })),
        ]);
        const bookings = bookingResult.Items ?? [];
        const learnerIds = [...new Set(bookings.map(row => String(row.learner_id)))];
        const learners = await Promise.all(learnerIds.map(async (id) => { try {
            return (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.learners, Key: { user_id: id } }))).Item;
        }
        catch {
            return undefined;
        } }));
        const learnerMap = new Map(learners.filter(Boolean).map(row => [String(row.user_id), { user_id: row.user_id, full_name: row.full_name, license_goal: row.license_goal, learning_style: row.learning_style, transmission_preference: row.transmission_preference }]));
        const profile = profileResult.Item ?? {};
        const { commission_rate: _commissionRate, ...instructorProfile } = profile;
        if (!profile.referral_code) {
            profile.referral_code = "MDI" + (0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 8).toUpperCase();
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: instructorId }, UpdateExpression: "SET referral_code=if_not_exists(referral_code,:code)", ExpressionAttributeValues: { ":code": profile.referral_code } }));
        }
        const completed = bookings.filter(row => row.status === "completed");
        const now = Date.now();
        const monthKeys = Array.from({ length: 6 }, (_, index) => { const date = new Date(); date.setMonth(date.getMonth() - (5 - index), 1); return date.toISOString().slice(0, 7); });
        const earningsTrend = monthKeys.map(month => ({ month, earnings: completed.filter(row => String(row.time ?? "").slice(0, 7) === month).reduce((sum, row) => sum + Number(row.instructor_payout ?? 0), 0), lessons: completed.filter(row => String(row.time ?? "").slice(0, 7) === month).length }));
        const studentIds = new Set(learnerIds);
        const activity = [...bookings.map(row => ({ type: "booking", date: row.created_at ?? row.time, text: `Lesson ${row.status} · ${row.lesson_type ?? "Driving lesson"}` })), ...(payoutRows.Items ?? []).map((row) => ({ type: "payout", date: row.created_at, text: `Payout ${row.status} · R${Number(row.amount ?? 0).toFixed(2)}` })), ...reviewRows.map(row => ({ type: "review", date: row.created_at, text: `Learner left a ${row.overall_rating ?? "new"}-star review` }))].sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? ""))).slice(0, 12);
        const derivedStats = { total_lessons: completed.length, total_earnings: completed.reduce((sum, row) => sum + Number(row.instructor_payout ?? 0), 0), avg_rating: reviewRows.length ? reviewRows.reduce((sum, row) => sum + Number(row.overall_rating ?? 0), 0) / reviewRows.length : 0, booking_completion_rate: bookings.length ? completed.length / bookings.length * 100 : 0 };
        const pointRows = await scanAll(dynamodb_js_1.tables.achievements);
        const pointsByInstructor = new Map();
        for (const achievement of pointRows) {
            const id = String(achievement.instructor_id ?? "");
            pointsByInstructor.set(id, (pointsByInstructor.get(id) ?? 0) + Number(achievement.points ?? 0));
        }
        const leaderboard = (await scanAll(dynamodb_js_1.tables.instructorStats)).sort((a, b) => (Number(b.avg_rating ?? 0) * 20 + Number(b.booking_completion_rate ?? 0) + Number(pointsByInstructor.get(String(b.instructor_id)) ?? 0) / 100) - (Number(a.avg_rating ?? 0) * 20 + Number(a.booking_completion_rate ?? 0) + Number(pointsByInstructor.get(String(a.instructor_id)) ?? 0) / 100)).slice(0, 10).map((row, index) => ({ rank: index + 1, instructor_id: row.instructor_id, points: pointsByInstructor.get(String(row.instructor_id)) ?? 0, score: Math.round(Number(row.avg_rating ?? 0) * 20 + Number(row.booking_completion_rate ?? 0) + Number(pointsByInstructor.get(String(row.instructor_id)) ?? 0) / 100) }));
        res.json({ profile: instructorProfile, bookings, pending: bookings.filter(row => row.status === "confirmed" && row.payment_status === "paid" && row.instructor_response === "pending"), upcoming: bookings.filter(row => row.status === "confirmed" && new Date(row.time).getTime() > now).sort((a, b) => String(a.time).localeCompare(String(b.time))), completed, earnings_trend: earningsTrend, students: [...studentIds].map(id => ({ ...(learnerMap.get(id) ?? { user_id: id, full_name: "Learner" }), bookings: bookings.filter(row => row.learner_id === id) })), payouts: (payoutRows.Items ?? []).sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))), lesson_plans: planRows.Items ?? [], progress: progressRows.Items ?? [], achievements: achievementRows.Items ?? [], campaigns: campaignRows, referrals: referralRows, reviews: reviewRows, learner_feedback: learnerFeedbackRows, messages: allMessages, stats: derivedStats, leaderboard, activity, currency: "ZAR", timezone: "Africa/Johannesburg" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/instructors/me/lesson-plans", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ learner_id: zod_1.z.string().min(1), booking_id: zod_1.z.string().min(1).optional(), topics: zod_1.z.array(zod_1.z.string()).min(1), exercises: zod_1.z.array(zod_1.z.string()), focus_areas: zod_1.z.array(zod_1.z.string()), teaching_strategy: zod_1.z.string(), homework: zod_1.z.string(), ai_generated: zod_1.z.boolean().default(false) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Add a learner, topics, and teaching strategy." });
            return;
        }
        const ownedBookings = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.bookings, IndexName: "InstructorBookings", KeyConditionExpression: "instructor_id=:id", ExpressionAttributeValues: { ":id": req.auth.sub }, Limit: 200 }))).Items ?? [];
        if (!ownedBookings.some(row => row.learner_id === body.data.learner_id && (!body.data.booking_id || row.id === body.data.booking_id))) {
            res.status(403).json({ error: "Lesson plans are available for your learners only." });
            return;
        }
        const item = { id: (0, node_crypto_1.randomUUID)(), instructor_id: req.auth.sub, ...body.data, booking_id: body.data.booking_id ?? `learner-${body.data.learner_id}`, status: "active", created_at: new Date().toISOString() };
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.lessonPlans, Item: item }));
        res.status(201).json({ item });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/instructors/me/messages", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const bookingId = zod_1.z.string().min(1).safeParse(req.query.booking_id);
        if (!bookingId.success) {
            res.status(400).json({ error: "Choose a booking conversation." });
            return;
        }
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId.data } }))).Item;
        if (!booking || booking.instructor_id !== req.auth.sub) {
            res.status(404).json({ error: "Booking not found." });
            return;
        }
        const messages = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.messages, IndexName: "BookingMessages", KeyConditionExpression: "booking_id=:id", ExpressionAttributeValues: { ":id": booking.id }, Limit: 100 }));
        res.json({ items: (messages.Items ?? []).sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))) });
    }
    catch (error) {
        next(error);
    }
});
// Shared booking conversations are available to both participants, including learners.
async function participantBooking(bookingId, userId) {
    const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId } }))).Item;
    return booking && [booking.learner_id, booking.instructor_id].includes(userId) ? booking : undefined;
}
app.get("/v1/messages/conversations", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner", "instructor"), requireCompleteParticipant, async (req, res, next) => {
    try {
        const bookings = await scanAll(dynamodb_js_1.tables.bookings);
        const mine = bookings.filter(row => [row.learner_id, row.instructor_id].includes(req.auth.sub)).sort((a, b) => String(b.time).localeCompare(String(a.time)));
        const messages = await scanAll(dynamodb_js_1.tables.messages);
        res.json({ items: mine.map(booking => {
                const rows = messages.filter(m => m.booking_id === booking.id).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
                return { booking, last_message: rows[0] ?? null, unread_count: rows.filter(m => m.receiver_id === req.auth.sub && m.read !== true).length };
            }) });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/realtime/config", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner", "instructor"), requireCompleteParticipant, (req, res) => { const token = req.header("authorization")?.replace(/^Bearer\s+/i, ""); res.json({ url: process.env.API_GATEWAY_WEBSOCKET_URL ?? null, token: token ?? null }); });
app.get("/v1/bookings/:id/messages", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner", "instructor"), requireCompleteParticipant, async (req, res, next) => {
    try {
        const booking = await participantBooking(String(req.params.id), req.auth.sub);
        if (!booking) {
            res.status(404).json({ error: "Booking conversation not found." });
            return;
        }
        const rows = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.messages, IndexName: "BookingMessages", KeyConditionExpression: "booking_id=:id", ExpressionAttributeValues: { ":id": booking.id }, Limit: 200 }));
        const items = (rows.Items ?? []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
        await Promise.all(items.filter(m => m.receiver_id === req.auth.sub && m.read !== true).map(m => dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.messages, Key: { id: m.id }, UpdateExpression: "SET #read=:yes,read_at=:at", ExpressionAttributeNames: { "#read": "read" }, ExpressionAttributeValues: { ":yes": true, ":at": new Date().toISOString() } }))));
        res.json({ items: items.map(m => m.receiver_id === req.auth.sub ? { ...m, read: true } : m) });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/bookings/:id/messages", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner", "instructor"), requireCompleteParticipant, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ content: zod_1.z.string().trim().min(1).max(4000) }).safeParse(req.body);
        const booking = await participantBooking(String(req.params.id), req.auth.sub);
        if (!body.success || !booking) {
            res.status(400).json({ error: "Choose a valid conversation and enter a message." });
            return;
        }
        const receiverId = booking.learner_id === req.auth.sub ? booking.instructor_id : booking.learner_id;
        const receiver = receiverId === booking.instructor_id ? (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: receiverId } }))).Item : undefined;
        const settings = receiver?.messaging_settings ?? {};
        if (receiverId === booking.instructor_id && settings.enabled === false) {
            res.status(403).json({ error: "This instructor has paused new messages." });
            return;
        }
        const now = new Date();
        const quiet = settings.quiet_hours;
        let quietNow = false;
        if (quiet?.enabled && /^\d{2}:\d{2}$/.test(quiet.start ?? "") && /^\d{2}:\d{2}$/.test(quiet.end ?? "")) {
            const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Johannesburg", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
            quietNow = quiet.start <= quiet.end ? time >= quiet.start && time < quiet.end : time >= quiet.start || time < quiet.end;
        }
        const item = { id: (0, node_crypto_1.randomUUID)(), booking_id: booking.id, sender_id: req.auth.sub, receiver_id: receiverId, content: body.data.content, read: false, created_at: now.toISOString() };
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.messages, Item: item }));
        await notifyUser(receiverId, "message", "New message", body.data.content.slice(0, 160), { booking_id: booking.id });
        if (quietNow && settings.auto_reply) {
            const reply = { id: (0, node_crypto_1.randomUUID)(), booking_id: booking.id, sender_id: receiverId, receiver_id: req.auth.sub, content: String(settings.auto_reply), read: false, automated: true, created_at: new Date(Date.now() + 1).toISOString() };
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.messages, Item: reply }));
            await notifyUser(String(req.auth.sub), "message", "Automatic reply", reply.content, { booking_id: booking.id });
        }
        res.status(201).json({ item });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/instructors/me/messaging-settings", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), async (req, res, next) => { try {
    const row = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub } }))).Item;
    res.json({ settings: row?.messaging_settings ?? { enabled: true, auto_reply: "", quiet_hours: { enabled: false, start: "20:00", end: "08:00" } } });
}
catch (error) {
    next(error);
} });
app.patch("/v1/instructors/me/messaging-settings", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ enabled: zod_1.z.boolean(), auto_reply: zod_1.z.string().max(500).default(""), quiet_hours: zod_1.z.object({ enabled: zod_1.z.boolean(), start: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: zod_1.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }).optional() }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Check message settings." });
            return;
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub }, UpdateExpression: "SET messaging_settings=:settings", ExpressionAttributeValues: { ":settings": body.data } }));
        res.json({ settings: body.data });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/notifications/push-token", auth_js_1.requireAuth, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ token: zod_1.z.string().min(20).max(4096) }).safeParse(req.body);
        const appArn = process.env.SNS_PLATFORM_APPLICATION_ARN;
        if (!body.success || !appArn) {
            res.status(503).json({ error: "Push registration is not configured." });
            return;
        }
        const { CreatePlatformEndpointCommand } = await import("@aws-sdk/client-sns");
        const result = await sns.send(new CreatePlatformEndpointCommand({ PlatformApplicationArn: appArn, Token: body.data.token, CustomUserData: req.auth.sub }));
        if (!result.EndpointArn) {
            res.status(502).json({ error: "Could not register push token." });
            return;
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: req.auth.sub }, UpdateExpression: "SET sns_endpoint_arn=:arn", ExpressionAttributeValues: { ":arn": result.EndpointArn } }));
        res.json({ status: "registered" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/bookings/:id/calls", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner", "instructor"), requireCompleteParticipant, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ scheduled_at: zod_1.z.string().datetime({ offset: true }).optional() }).safeParse(req.body);
        const booking = await participantBooking(String(req.params.id), req.auth.sub);
        if (!body.success || !booking) {
            res.status(404).json({ error: "Booking conversation not found." });
            return;
        }
        const lkUrl = process.env.LIVEKIT_URL, lkKey = process.env.LIVEKIT_API_KEY, lkSecret = process.env.LIVEKIT_API_SECRET;
        if (!lkUrl || !lkKey || !lkSecret) {
            res.status(503).json({ error: "Video calls are not configured yet." });
            return;
        }
        const starts = body.data.scheduled_at ? new Date(body.data.scheduled_at) : new Date();
        if (body.data.scheduled_at && starts.getTime() < Date.now() - 60000) {
            res.status(400).json({ error: "Choose a future call time." });
            return;
        }
        const roomName = "md-" + (0, node_crypto_1.randomUUID)().replace(/-/g, "").slice(0, 24);
        const expires = Math.floor((Math.max(starts.getTime(), Date.now()) + 4 * 3600000) / 1000);
        const lkApi = new livekit_server_sdk_1.RoomServiceClient(lkUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:"), lkKey, lkSecret);
        await lkApi.createRoom({ name: roomName, emptyTimeout: 600, maxParticipants: 4 });
        const at = new livekit_server_sdk_1.AccessToken(lkKey, lkSecret, { identity: req.auth.sub, name: req.auth.email ?? "iDriveMzansi user", ttl: Math.max(600, expires - Math.floor(Date.now() / 1000)) });
        at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true });
        const jwt = await at.toJwt();
        const token = { token: jwt };
        const call = { id: roomName, booking_id: booking.id, instructor_id: booking.instructor_id, learner_id: booking.learner_id, room_url: lkUrl, scheduled_at: starts.toISOString(), created_by: req.auth.sub, created_at: new Date().toISOString() };
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.videoLessons, Item: call }));
        const other = req.auth.sub === booking.learner_id ? booking.instructor_id : booking.learner_id;
        await notifyUser(other, "video_call", "Video call invitation", body.data.scheduled_at ? `A lesson video call was scheduled for ${starts.toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg" })}.` : "Your lesson partner started a video call.", { booking_id: booking.id, call_id: roomName });
        res.status(201).json({ ...call, token: token.token });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/bookings/:id/location", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner", "instructor"), requireCompleteParticipant, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ latitude: zod_1.z.number().min(-90).max(90), longitude: zod_1.z.number().min(-180).max(180), accuracy: zod_1.z.number().nonnegative().optional(), battery_level: zod_1.z.number().min(0).max(1).optional() }).safeParse(req.body);
        const booking = await participantBooking(String(req.params.id), req.auth.sub);
        if (!body.success || !booking || booking.status !== "confirmed") {
            res.status(404).json({ error: "Location sharing requires a confirmed lesson." });
            return;
        }
        const starts = new Date(booking.time).getTime();
        if (Date.now() < starts - 30 * 60000 || Date.now() >= starts) {
            res.status(409).json({ error: "Live location sharing is available only in the 30 minutes before the lesson starts." });
            return;
        }
        const slot = req.auth.sub === booking.learner_id ? "learner_location" : "instructor_location";
        const location = { ...body.data, updated_at: new Date().toISOString() };
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: `SET ${slot}=:location`, ExpressionAttributeValues: { ":location": location } }));
        const refreshed = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id } }))).Item;
        res.json({ shared: true, locations: { learner: refreshed?.learner_location ?? null, instructor: refreshed?.instructor_location ?? null }, pickup_coordinates: booking.pickup_coordinates ?? null });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/bookings/:id/location", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner", "instructor"), requireCompleteParticipant, async (req, res, next) => { try {
    const booking = await participantBooking(String(req.params.id), req.auth.sub);
    if (!booking) {
        res.status(404).json({ error: "Booking not found." });
        return;
    }
    const learner = booking.learner_location, instructor = booking.instructor_location, target = booking.pickup_coordinates ?? learner;
    let distance_km, eta_minutes;
    const current = instructor;
    if (current && target) {
        const rad = (value) => value * Math.PI / 180;
        const dLat = rad(Number(target.latitude) - Number(current.latitude)), dLon = rad(Number(target.longitude) - Number(current.longitude)), a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(Number(current.latitude))) * Math.cos(rad(Number(target.latitude))) * Math.sin(dLon / 2) ** 2;
        distance_km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        eta_minutes = Math.ceil(distance_km / 30 * 60);
    }
    res.json({ locations: { learner: learner ?? null, instructor: instructor ?? null }, pickup_coordinates: booking.pickup_coordinates ?? null, share_ends_at: booking.time, distance_km: distance_km === undefined ? undefined : Number(distance_km.toFixed(1)), eta_minutes });
}
catch (error) {
    next(error);
} });
app.post("/v1/bookings/:id/active-session", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner", "instructor"), requireCompleteParticipant, async (req, res, next) => {
    try {
        const booking = await participantBooking(String(req.params.id), req.auth.sub);
        if (!booking || !(["confirmed"].includes(booking.status))) {
            res.status(404).json({ error: "Confirmed lesson not found." });
            return;
        }
        const body = zod_1.z.object({ action: zod_1.z.enum(["start", "update", "stop"]), speed_kmh: zod_1.z.number().min(0).max(300).optional(), mastered_skills: zod_1.z.array(zod_1.z.string().max(100)).max(100).optional(), safety_checks: zod_1.z.record(zod_1.z.string(), zod_1.z.boolean()).optional(), signature_data_url: zod_1.z.string().max(300000).optional() }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Invalid active session update." });
            return;
        }
        const patch = body.data;
        const expr = [];
        const vals = {};
        if (patch.action === "start") {
            expr.push("session_started_at=if_not_exists(session_started_at,:now)");
            vals[":now"] = new Date().toISOString();
        }
        if (patch.action === "stop")
            expr.push("session_stopped_at=:now"), vals[":now"] = new Date().toISOString();
        if (patch.speed_kmh !== undefined)
            expr.push("session_speed_kmh=:speed"), vals[":speed"] = patch.speed_kmh;
        if (patch.mastered_skills)
            expr.push("session_mastered_skills=:skills"), vals[":skills"] = patch.mastered_skills;
        if (patch.safety_checks)
            expr.push("session_safety_checks=:checks"), vals[":checks"] = patch.safety_checks;
        if (patch.signature_data_url) {
            const match = patch.signature_data_url.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
            if (!match) {
                res.status(400).json({ error: "Invalid signature image." });
                return;
            }
            const key = `lesson-signatures/${booking.id}/${req.auth.sub}.png`;
            await s3_js_1.s3.send(new client_s3_1.PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: Buffer.from(match[1], "base64"), ContentType: "image/png", ServerSideEncryption: "AES256" }));
            expr.push(req.auth.sub === booking.learner_id ? "learner_signature_key=:sig" : "instructor_signature_key=:sig");
            vals[":sig"] = key;
        }
        if (expr.length)
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET " + expr.join(","), ExpressionAttributeValues: vals }));
        res.json({ status: patch.action, session_started_at: booking.session_started_at ?? (patch.action === "start" ? new Date().toISOString() : undefined) });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/bookings/:id/sos", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("learner", "instructor"), requireCompleteParticipant, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ latitude: zod_1.z.number().min(-90).max(90), longitude: zod_1.z.number().min(-180).max(180), speed_kmh: zod_1.z.number().min(0).max(300), details: zod_1.z.string().max(2000).default("") }).safeParse(req.body);
        const booking = await participantBooking(String(req.params.id), req.auth.sub);
        if (!body.success || !booking) {
            res.status(404).json({ error: "Active lesson not found." });
            return;
        }
        const incident = { id: (0, node_crypto_1.randomUUID)(), booking_id: booking.id, reported_by: req.auth.sub, reported_at: new Date().toISOString(), latitude: body.data.latitude, longitude: body.data.longitude, speed_kmh: body.data.speed_kmh, details: body.data.details, lesson_time: booking.time };
        const key = `incidents/${booking.id}/${incident.id}.json`;
        await s3_js_1.s3.send(new client_s3_1.PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key, Body: JSON.stringify(incident), ContentType: "application/json", ServerSideEncryption: "AES256" }));
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.disputes, Item: { id: incident.id, booking_id: booking.id, filed_by: req.auth.sub, type: "safety_incident", description: body.data.details || "SOS alert raised during active driving session.", status: "open", incident_s3_key: key, created_at: incident.reported_at } }));
        const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: booking.instructor_id } }))).Item;
        const company = booking.company_id ? (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: booking.company_id } }))).Item : undefined;
        const emails = [String(instructor?.email ?? ""), "incidents@mzansidrive.co.za", ...(company?.admin_contacts ?? []).map((c) => typeof c === "string" ? c : c.email ?? c.contact_email)].filter(Boolean);
        const content = `SOS incident ${incident.id}\nBooking: ${booking.id}\nTime: ${incident.reported_at}\nGPS: ${incident.latitude}, ${incident.longitude}\nSpeed: ${incident.speed_kmh} km/h\nDetails: ${incident.details}\nS3 report: ${key}`;
        await Promise.all(emails.map(to => sendEmail(to, "iDriveMzansi urgent lesson SOS incident", content).catch(e => console.error("SOS email failed", e))));
        res.status(201).json({ incident_id: incident.id, status: "reported" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/instructors/me/messages", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ booking_id: zod_1.z.string().min(1), content: zod_1.z.string().trim().min(1).max(4000) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Enter a message and booking." });
            return;
        }
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: body.data.booking_id } }))).Item;
        if (!booking || booking.instructor_id !== req.auth.sub) {
            res.status(404).json({ error: "Booking not found." });
            return;
        }
        const item = { id: (0, node_crypto_1.randomUUID)(), booking_id: booking.id, sender_id: req.auth.sub, receiver_id: booking.learner_id, content: body.data.content, read: false, created_at: new Date().toISOString() };
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.messages, Item: item }));
        res.status(201).json({ item });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/instructors/me/review-learner", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ booking_id: zod_1.z.string().min(1), attitude: zod_1.z.number().int().min(1).max(5), punctuality: zod_1.z.number().int().min(1).max(5), progress_rating: zod_1.z.number().int().min(1).max(5), feedback: zod_1.z.string().max(2000) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Complete all learner review ratings." });
            return;
        }
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: body.data.booking_id } }))).Item;
        if (!booking || booking.instructor_id !== req.auth.sub || booking.status !== "completed") {
            res.status(404).json({ error: "Completed lesson not found." });
            return;
        }
        const item = { id: booking.id, ...body.data, booking_id: booking.id, instructor_id: req.auth.sub, learner_id: booking.learner_id, created_at: new Date().toISOString() };
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.learnerReviews, Item: item }));
        res.status(201).json({ item });
    }
    catch (error) {
        next(error);
    }
});
app.put("/v1/instructors/me/blocked-dates", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ dates: zod_1.z.array(zod_1.z.string().date()).max(200) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Provide blocked dates in YYYY-MM-DD format." });
            return;
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub }, UpdateExpression: "SET blocked_dates=:dates", ExpressionAttributeValues: { ":dates": [...new Set(body.data.dates)] } }));
        res.json({ dates: body.data.dates });
    }
    catch (error) {
        next(error);
    }
});
app.patch("/v1/instructors/me/payout-schedule", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), requireInstructorComplete, async (req, res, next) => {
    try {
        const body = zod_1.z.object({ schedule: zod_1.z.enum(["weekly", "biweekly"]) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Choose weekly or biweekly payout schedule." });
            return;
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub }, UpdateExpression: "SET payout_schedule=:schedule", ExpressionAttributeValues: { ":schedule": body.data.schedule } }));
        res.json({ schedule: body.data.schedule });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/company/:companyId/dashboard", auth_js_1.requireAuth, async (req, res, next) => {
    try {
        const company = await getManagedCompany(String(req.params.companyId), req.auth);
        if (!company) {
            res.status(404).json({ error: "Company dashboard not found for this account." });
            return;
        }
        const [instructors, users, allBookings, payouts] = await Promise.all([scanAll(dynamodb_js_1.tables.instructors), scanAll(dynamodb_js_1.tables.users), scanAll(dynamodb_js_1.tables.bookings), scanAll(dynamodb_js_1.tables.payouts)]);
        const linked = instructors.filter(item => item.company_id === company.id);
        const ids = new Set(linked.map(item => String(item.user_id)));
        const userMap = new Map(users.map(user => [String(user.id), user]));
        const bookings = allBookings.filter(item => item.company_id === company.id || ids.has(String(item.instructor_id))).sort((a, b) => String(b.time ?? "").localeCompare(String(a.time ?? "")));
        const companyPayouts = payouts.filter(item => item.company_id === company.id || item.payee_type === "company" && item.payee_id === company.id).sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
        const start = String(req.query.start ?? "");
        const end = String(req.query.end ?? "");
        const selected = bookings.filter(item => (!start || String(item.date ?? item.time).slice(0, 10) >= start) && (!end || String(item.date ?? item.time).slice(0, 10) <= end));
        const instructorRows = await Promise.all(linked.map(async (item) => { const ratings = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.QueryCommand({ TableName: dynamodb_js_1.tables.reviews, IndexName: "InstructorReviews", KeyConditionExpression: "instructor_id=:id", ExpressionAttributeValues: { ":id": item.user_id }, Limit: 100 })).catch(() => ({ Items: [] })); const rows = bookings.filter(booking => booking.instructor_id === item.user_id); const completed = rows.filter(booking => booking.status === "completed"); const reviewRows = ratings.Items ?? []; const avg = reviewRows.length ? reviewRows.reduce((sum, row) => sum + Number(row.overall_rating ?? 0), 0) / reviewRows.length : 0; const completion = rows.length ? completed.length / rows.length * 100 : 0; const score = Math.round(avg * 12 + completion * 0.4 + Math.min(10, rows.length)); const documentLinks = {}; for (const [name, key] of Object.entries(item.documents ?? {})) {
            if (typeof key === "string" && key.startsWith(`private/${item.user_id}/`))
                documentLinks[name] = await (0, s3_request_presigner_1.getSignedUrl)(s3_js_1.s3, new client_s3_1.GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), { expiresIn: 600 });
        } return { ...item, email: item.email ?? userMap.get(String(item.user_id))?.email, documents: undefined, document_links: documentLinks, document_verification: item.document_verification ?? {}, stats: { lessons: rows.length, completed: completed.length, revenue: completed.reduce((sum, booking) => sum + Number(booking.instructor_payout ?? 0), 0), avg_rating: Number(avg.toFixed(2)), completion_rate: Number(completion.toFixed(1)), score } }; }));
        const monthly = Array.from({ length: 12 }, (_, index) => { const d = new Date(); d.setMonth(d.getMonth() - (11 - index), 1); const month = d.toISOString().slice(0, 7); const rows = selected.filter(item => String(item.time ?? item.date ?? "").slice(0, 7) === month); return { month, bookings: rows.length, revenue: rows.filter(item => item.payment_status === "paid").reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0) }; });
        const revenueByInstructor = instructorRows.map(item => { const rows = selected.filter(booking => booking.instructor_id === item.user_id && booking.status === "completed"); return { instructor_id: item.user_id, name: item.full_name ?? item.user_id, revenue: rows.reduce((sum, booking) => sum + Number(booking.instructor_payout ?? 0), 0), lessons: rows.length }; });
        const revenueByLesson = Object.entries(selected.reduce((acc, item) => { const type = String(item.lesson_type ?? "Other"); acc[type] = (acc[type] ?? 0) + Number(item.total_amount ?? 0); return acc; }, {})).map(([lesson_type, revenue]) => ({ lesson_type, revenue })).sort((a, b) => b.revenue - a.revenue);
        const locations = Object.entries(selected.reduce((acc, item) => { const place = String(item.pickup_address ?? "").split(",").slice(-3, -2)[0]?.trim() || "Unknown"; acc[place] = (acc[place] ?? 0) + 1; return acc; }, {})).map(([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count).slice(0, 10);
        const resources = await Promise.all((company.resources ?? []).map(async (resource) => ({ ...resource, url: typeof resource.object_key === "string" ? await (0, s3_request_presigner_1.getSignedUrl)(s3_js_1.s3, new client_s3_1.GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: resource.object_key }), { expiresIn: 600 }) : undefined })));
        res.json({ company: { ...company, account_number: company.account_number ? `••••${String(company.account_number).slice(-4)}` : "" }, instructors: instructorRows, bookings, payouts: companyPayouts, resources, analytics: { trends: monthly, revenue_by_instructor: revenueByInstructor, revenue_by_lesson: revenueByLesson, locations }, metrics: { instructors: linked.length, bookings: bookings.length, revenue: bookings.filter(item => item.payment_status === "paid").reduce((sum, item) => sum + Number(item.total_amount ?? 0), 0), platform_fees: bookings.filter(item => item.payment_status === "paid").reduce((sum, item) => sum + Number(item.platform_fee ?? 0), 0), pending_payout: companyPayouts.filter(item => item.status === "company_pending").reduce((sum, item) => sum + Number(item.amount ?? 0), 0) }, currency: "ZAR", timezone: "Africa/Johannesburg" });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/company", auth_js_1.requireAuth, async (req, res, next) => { try {
    const rows = await scanAll(dynamodb_js_1.tables.companies);
    const managed = rows.filter(company => companyCanManage(company, req.auth)).map(company => ({ id: company.id, official_name: company.official_name, trading_as: company.trading_as }));
    res.json({ items: managed });
}
catch (error) {
    next(error);
} });
app.post("/v1/company/accept-invite", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("instructor"), async (req, res, next) => { try {
    const body = zod_1.z.object({ token: zod_1.z.string().uuid() }).safeParse(req.body);
    if (!body.success || !req.auth.email) {
        res.status(400).json({ error: "A valid instructor invitation and signed-in email are required." });
        return;
    }
    const companies = await scanAll(dynamodb_js_1.tables.companies);
    const company = companies.find(row => (row.invitations ?? []).some((invite) => invite.token === body.data.token && invite.email === req.auth.email.toLowerCase() && invite.status === "pending"));
    if (!company) {
        res.status(404).json({ error: "This instructor invitation is invalid or no longer active." });
        return;
    }
    const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub } }))).Item;
    if (!instructor) {
        res.status(409).json({ error: "Complete your instructor profile before accepting this company invitation." });
        return;
    }
    if (instructor.company_id && instructor.company_id !== company.id) {
        res.status(409).json({ error: "This instructor account is linked to another company." });
        return;
    }
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub }, UpdateExpression: "SET company_id=:company", ExpressionAttributeValues: { ":company": company.id } }));
    const invitations = (company.invitations ?? []).map((invite) => invite.token === body.data.token ? { ...invite, status: "accepted", accepted_by: req.auth.sub, accepted_at: new Date().toISOString() } : invite);
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: company.id }, UpdateExpression: "SET invitations=:invitations", ExpressionAttributeValues: { ":invitations": invitations } }));
    res.json({ company_id: company.id, status: "accepted" });
}
catch (error) {
    next(error);
} });
app.patch("/v1/company/:companyId/settings", auth_js_1.requireAuth, async (req, res, next) => { try {
    const company = await getManagedCompany(String(req.params.companyId), req.auth);
    if (!company) {
        res.status(404).json({ error: "Company not found." });
        return;
    }
    const body = zod_1.z.object({ official_name: zod_1.z.string().trim().min(2).max(180).optional(), trading_as: zod_1.z.string().max(180).optional(), registration_number: zod_1.z.string().max(80).optional(), vat_number: zod_1.z.string().max(80).optional(), company_mission: zod_1.z.string().max(2000).optional(), about_us: zod_1.z.string().max(4000).optional(), elevator_pitch: zod_1.z.string().max(500).optional(), linkedin_bio: zod_1.z.string().max(2000).optional(), social_handles: zod_1.z.record(zod_1.z.string().max(240)).optional(), owners: zod_1.z.array(zod_1.z.union([zod_1.z.string().email(), zod_1.z.object({ user_id: zod_1.z.string().optional(), email: zod_1.z.string().email().optional(), name: zod_1.z.string().optional() })])).max(30).optional(), admin_contacts: zod_1.z.array(zod_1.z.union([zod_1.z.string().email(), zod_1.z.object({ user_id: zod_1.z.string().optional(), email: zod_1.z.string().email().optional(), name: zod_1.z.string().optional() })])).max(30).optional(), bank_name: zod_1.z.string().max(120).optional(), account_number: zod_1.z.string().regex(/^\d{6,20}$/).optional(), bank_code: zod_1.z.string().regex(/^\d{4,12}$/).optional() }).strict().safeParse(req.body);
    if (!body.success || !Object.keys(body.data ?? {}).length) {
        res.status(400).json({ error: "Enter valid company details." });
        return;
    }
    const names = { "#at": "updated_at" };
    const values = { ":at": new Date().toISOString() };
    const sets = ["#at=:at"];
    Object.entries(body.data).forEach(([key, value], index) => { names[`#f${index}`] = key; values[`:v${index}`] = value; sets.push(`#f${index}=:v${index}`); });
    const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: company.id }, UpdateExpression: "SET " + sets.join(","), ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: "ALL_NEW" }));
    if ((body.data.account_number || body.data.bank_code) && company.paystack_recipient_code)
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: company.id }, UpdateExpression: "REMOVE paystack_recipient_code" }));
    res.json({ item: result.Attributes });
}
catch (error) {
    next(error);
} });
app.post("/v1/company/:companyId/membership", auth_js_1.requireAuth, async (req, res, next) => { try {
    const company = await getManagedCompany(String(req.params.companyId), req.auth);
    if (!company) {
        res.status(404).json({ error: "Company not found." });
        return;
    }
    const body = zod_1.z.object({ tier: zod_1.z.enum(["weekly", "monthly"]) }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: "Choose weekly or monthly membership." });
        return;
    }
    const user = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: req.auth.sub } }))).Item;
    const planCode = process.env[body.data.tier === "weekly" ? "PAYSTACK_COMPANY_WEEKLY_PLAN" : "PAYSTACK_COMPANY_MONTHLY_PLAN"];
    if (!planCode) {
        res.status(503).json({ error: "Company membership plan is not configured." });
        return;
    }
    const reference = `company-member-${(0, node_crypto_1.randomUUID)()}`;
    const checkout = await (0, paystack_js_1.paystack)("/transaction/initialize", { email: user?.email, amount: "100", currency: "ZAR", plan: planCode, reference, callback_url: process.env.PAYSTACK_CALLBACK_URL, metadata: { kind: "company_membership", company_id: company.id, tier: body.data.tier } });
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Item: { id: checkout.reference, company_id: company.id, kind: "company_membership", tier: body.data.tier, amount: 0, currency: "ZAR", status: "pending", created_at: new Date().toISOString() } }));
    res.json({ authorization_url: checkout.authorization_url, reference: checkout.reference });
}
catch (error) {
    next(error);
} });
app.post("/v1/company/:companyId/invites", auth_js_1.requireAuth, async (req, res, next) => { try {
    const company = await getManagedCompany(String(req.params.companyId), req.auth);
    if (!company) {
        res.status(404).json({ error: "Company not found." });
        return;
    }
    const body = zod_1.z.object({ emails: zod_1.z.array(emailSchema).min(1).max(200) }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: "Provide valid instructor email addresses." });
        return;
    }
    const invitations = [...(company.invitations ?? [])];
    const created = [];
    for (const email of [...new Set(body.data.emails)]) {
        let invite = invitations.find((row) => row.email === email && row.status === "pending");
        if (!invite) {
            invite = { email, token: (0, node_crypto_1.randomUUID)(), status: "pending", invited_at: new Date().toISOString(), invited_by: req.auth.sub };
            invitations.push(invite);
        }
        const base = (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",")[0];
        await sendEmail(email, `Join ${company.trading_as ?? company.official_name} on iDriveMzansi`, `You have been invited to join ${company.trading_as ?? company.official_name} as an instructor. Create a new instructor account here: ${base}/signup?role=instructor&company_invite=${invite.token}\n\nIf you already have an instructor account, sign in to accept the invitation: ${base}/login?company_invite=${invite.token}`);
        created.push(email);
    }
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: company.id }, UpdateExpression: "SET invitations=:invitations", ExpressionAttributeValues: { ":invitations": invitations } }));
    res.status(201).json({ invited: created.length, emails: created });
}
catch (error) {
    next(error);
} });
app.patch("/v1/company/:companyId/instructors/:instructorId", auth_js_1.requireAuth, async (req, res, next) => { try {
    const company = await getManagedCompany(String(req.params.companyId), req.auth);
    if (!company) {
        res.status(404).json({ error: "Company not found." });
        return;
    }
    const body = zod_1.z.object({ action: zod_1.z.enum(["link", "unlink"]) }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: "Choose link or unlink." });
        return;
    }
    const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.params.instructorId } }))).Item;
    if (!instructor) {
        res.status(404).json({ error: "Instructor account not found." });
        return;
    }
    if (body.data.action === "link") {
        if (instructor.company_id && instructor.company_id !== company.id) {
            res.status(409).json({ error: "Instructor is already linked to another company." });
            return;
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: instructor.user_id }, UpdateExpression: "SET company_id=:company", ExpressionAttributeValues: { ":company": company.id } }));
    }
    else {
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: instructor.user_id }, UpdateExpression: "REMOVE company_id", ConditionExpression: "company_id=:company", ExpressionAttributeValues: { ":company": company.id } }));
    }
    res.json({ status: body.data.action === "link" ? "linked" : "unlinked" });
}
catch (error) {
    next(error);
} });
app.patch("/v1/company/:companyId/instructors/:instructorId/compliance", auth_js_1.requireAuth, async (req, res, next) => { try {
    const company = await getManagedCompany(String(req.params.companyId), req.auth);
    if (!company) {
        res.status(404).json({ error: "Company not found." });
        return;
    }
    const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.params.instructorId } }))).Item;
    if (!instructor || instructor.company_id !== company.id) {
        res.status(404).json({ error: "Linked instructor not found." });
        return;
    }
    const body = zod_1.z.object({ status: zod_1.z.enum(["pending", "compliant", "non_compliant"]), notes: zod_1.z.string().max(2000) }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: "Set a company compliance status and notes." });
        return;
    }
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: instructor.user_id }, UpdateExpression: "SET company_compliance_status=:status,company_compliance_notes=:notes,company_compliance_reviewed_at=:at", ExpressionAttributeValues: { ":status": body.data.status, ":notes": body.data.notes, ":at": new Date().toISOString() } }));
    res.json({ status: body.data.status });
}
catch (error) {
    next(error);
} });
app.post("/v1/company/:companyId/resources/presign", auth_js_1.requireAuth, async (req, res, next) => { try {
    const company = await getManagedCompany(String(req.params.companyId), req.auth);
    if (!company) {
        res.status(404).json({ error: "Company not found." });
        return;
    }
    const body = zod_1.z.object({ fileName: zod_1.z.string().min(1).max(180), contentType: zod_1.z.enum(["image/jpeg", "image/png", "application/pdf", "image/webp"]) }).safeParse(req.body);
    const bucket = process.env.S3_BUCKET;
    if (!body.success) {
        res.status(400).json({ error: "Upload a PDF, JPEG, PNG, or WebP resource." });
        return;
    }
    if (!bucket) {
        res.status(503).json({ error: "Private file storage is not configured." });
        return;
    }
    const ext = body.data.fileName.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const key = `private/companies/${company.id}/resources/${(0, node_crypto_1.randomUUID)()}.${ext}`;
    const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3_js_1.s3, new client_s3_1.PutObjectCommand({ Bucket: bucket, Key: key, ContentType: body.data.contentType, ServerSideEncryption: "AES256" }), { expiresIn: 300 });
    res.json({ uploadUrl, objectKey: key, expiresIn: 300 });
}
catch (error) {
    next(error);
} });
app.post("/v1/company/:companyId/resources", auth_js_1.requireAuth, async (req, res, next) => { try {
    const company = await getManagedCompany(String(req.params.companyId), req.auth);
    if (!company) {
        res.status(404).json({ error: "Company not found." });
        return;
    }
    const body = zod_1.z.object({ object_key: zod_1.z.string().startsWith(`private/companies/${req.params.companyId}/resources/`), name: zod_1.z.string().min(1).max(180), category: zod_1.z.enum(["logo", "vehicle_details", "training_material", "other"]) }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: "Invalid resource record." });
        return;
    }
    await s3_js_1.s3.send(new client_s3_1.HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: body.data.object_key }));
    const resources = [...(company.resources ?? []), { id: (0, node_crypto_1.randomUUID)(), ...body.data, uploaded_by: req.auth.sub, created_at: new Date().toISOString() }];
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: company.id }, UpdateExpression: "SET resources=:resources", ExpressionAttributeValues: { ":resources": resources } }));
    res.status(201).json({ resource: resources.at(-1) });
}
catch (error) {
    next(error);
} });
app.post("/v1/company/:companyId/payouts/process", auth_js_1.requireAuth, async (req, res, next) => {
    let lockOwner = "";
    let lockId = "";
    try {
        const company = await getManagedCompany(String(req.params.companyId), req.auth);
        if (!company) {
            res.status(404).json({ error: "Company not found." });
            return;
        }
        lockId = `company-payout#${company.id}`;
        lockOwner = (0, node_crypto_1.randomUUID)();
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.bookingLocks, Item: { id: lockId, owner: lockOwner, expires_at: Math.floor((Date.now() + 10 * 60 * 1000) / 1000) }, ConditionExpression: "attribute_not_exists(id) OR expires_at <= :now", ExpressionAttributeValues: { ":now": Math.floor(Date.now() / 1000) } }));
        const [bookings, instructors] = await Promise.all([scanAll(dynamodb_js_1.tables.bookings), scanAll(dynamodb_js_1.tables.instructors)]);
        const linkedIds = new Set(instructors.filter(item => item.company_id === company.id).map(item => item.user_id));
        const eligible = bookings.filter(row => (row.company_id === company.id || linkedIds.has(row.instructor_id)) && row.payment_status === "paid" && row.status === "completed" && row.instructor_marked_complete === true && row.learner_confirmed_complete === true && ["company_pending", "failed"].includes(String(row.payout_status ?? "company_pending")));
        if (!eligible.length) {
            res.status(409).json({ error: "There are no confirmed company payouts ready to process." });
            return;
        }
        const recipient = await instructorOrCompanyRecipient({ company_id: company.id });
        const amount = eligible.reduce((sum, row) => sum + Number(row.instructor_payout ?? 0), 0);
        const batchId = `company-${(0, node_crypto_1.randomUUID)()}`;
        const reference = `mdc-${batchId}`;
        const batch = { id: batchId, company_id: company.id, payee_id: company.id, payee_type: "company", booking_ids: eligible.map(row => row.id), amount, status: "processing", platform_fee_deductions: eligible.reduce((sum, row) => sum + Number(row.platform_fee ?? 0), 0), currency: "ZAR", created_at: new Date().toISOString(), paystack_reference: reference };
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.payouts, Item: batch, ConditionExpression: "attribute_not_exists(id)" }));
        try {
            const transfer = await (0, paystack_js_1.paystack)("/transfer", { source: "balance", amount: (0, paystack_js_1.toMinorUnits)(amount), recipient: recipient.code, reason: `${company.trading_as ?? company.official_name} instructor payouts`, reference, currency: "ZAR" });
            const status = transfer.status === "otp" ? "awaiting_otp" : "processing";
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: batchId }, UpdateExpression: "SET #status=:status,paystack_transfer_code=:code", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":status": status, ":code": transfer.transfer_code } }));
            await Promise.all(eligible.map(row => dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: row.id }, UpdateExpression: "SET payout_status=:processing", ConditionExpression: "payout_status=:pending OR payout_status=:failed OR attribute_not_exists(payout_status)", ExpressionAttributeValues: { ":processing": status, ":pending": "company_pending", ":failed": "failed" } }))));
            const lessonPayouts = await scanAll(dynamodb_js_1.tables.payouts);
            await Promise.all(eligible.map(row => { const item = lessonPayouts.find(p => p.booking_id === row.id); return item ? dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: item.id }, UpdateExpression: "SET #status=:status,company_batch_id=:batch", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":status": status, ":batch": batchId } })) : Promise.resolve(); }));
            res.status(201).json({ id: batchId, status, amount, booking_count: eligible.length, platform_fee_deductions: batch.platform_fee_deductions });
        }
        catch (error) {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: batchId }, UpdateExpression: "SET #status=:failed", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":failed": "failed" } }));
            throw error;
        }
    }
    catch (error) {
        if (error.name === "ConditionalCheckFailedException") {
            res.status(409).json({ error: "A company payout batch is already being processed." });
            return;
        }
        next(error);
    }
    finally {
        if (lockId && lockOwner)
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.DeleteCommand({ TableName: dynamodb_js_1.tables.bookingLocks, Key: { id: lockId }, ConditionExpression: "owner=:owner", ExpressionAttributeValues: { ":owner": lockOwner } })).catch(() => undefined);
    }
});
app.post("/v1/company/:companyId/payouts/:id/finalize", auth_js_1.requireAuth, async (req, res, next) => { try {
    const company = await getManagedCompany(String(req.params.companyId), req.auth);
    if (!company) {
        res.status(404).json({ error: "Company not found." });
        return;
    }
    const body = zod_1.z.object({ otp: zod_1.z.string().trim().min(4).max(10) }).safeParse(req.body);
    const payout = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: req.params.id } }))).Item;
    if (!body.success || !payout || payout.company_id !== company.id || payout.status !== "awaiting_otp" || !payout.paystack_transfer_code) {
        res.status(409).json({ error: "This company payout is not waiting for authorization." });
        return;
    }
    const result = await (0, paystack_js_1.paystack)("/transfer/finalize_transfer", { transfer_code: payout.paystack_transfer_code, otp: body.data.otp });
    const status = result.status === "success" ? "completed" : "processing";
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: payout.id }, UpdateExpression: "SET #status=:status", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":status": status } }));
    if (status === "completed")
        await Promise.all((payout.booking_ids ?? []).map(async (id) => { await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id }, UpdateExpression: "SET payout_status=:status", ExpressionAttributeValues: { ":status": "completed" } })); await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: `booking-${id}` }, UpdateExpression: "SET #status=:status", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":status": "completed" } })).catch(() => undefined); }));
    res.json({ status });
}
catch (error) {
    next(error);
} });
app.get("/v1/admin/overview", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        const [instructors, users, bookings, disputes, companies, payments, payouts] = await Promise.all([scanAll(dynamodb_js_1.tables.instructors), scanAll(dynamodb_js_1.tables.users), scanAll(dynamodb_js_1.tables.bookings), scanAll(dynamodb_js_1.tables.disputes), scanAll(dynamodb_js_1.tables.companies), scanAll(dynamodb_js_1.tables.paymentTransactions), scanAll(dynamodb_js_1.tables.payouts)]);
        const userMap = new Map(users.map(row => [String(row.id), row]));
        const monthKeys = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setMonth(d.getMonth() - (5 - i), 1); return d.toISOString().slice(0, 7); });
        const trends = monthKeys.map(month => { const rows = bookings.filter(row => String(row.created_at ?? row.time ?? "").slice(0, 7) === month); return { month, bookings: rows.length, revenue: rows.filter(row => row.payment_status === "paid").reduce((sum, row) => sum + Number(row.platform_fee ?? 0), 0) }; });
        const locations = Object.entries(bookings.reduce((acc, row) => { const city = String(row.pickup_address ?? "").split(",").slice(-3, -2)[0]?.trim() || "Unknown"; acc[city] = (acc[city] ?? 0) + 1; return acc; }, {})).map(([city, count]) => ({ city, bookings: count })).sort((a, b) => b.bookings - a.bookings).slice(0, 10);
        res.json({ instructors: instructors.map(row => ({ ...row, email: row.email ?? userMap.get(String(row.user_id))?.email, commission_rate: Number(row.commission_rate ?? 15) })), users, bookings, disputes, companies, paymentTransactions: payments, payouts, analytics: { trends, locations, totals: { bookings: bookings.length, revenue: bookings.filter(row => row.payment_status === "paid").reduce((sum, row) => sum + Number(row.platform_fee ?? 0), 0), instructors: instructors.length, learners: users.filter(row => row.user_type === "learner").length } }, currency: "ZAR", timezone: "Africa/Johannesburg" });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/admin/bookings", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (_req, res, next) => { try {
    res.json({ items: (await scanAll(dynamodb_js_1.tables.bookings)).sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))) });
}
catch (error) {
    next(error);
} });
app.get("/v1/admin/disputes", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (_req, res, next) => { try {
    res.json({ items: (await scanAll(dynamodb_js_1.tables.disputes)).sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))) });
}
catch (error) {
    next(error);
} });
app.get("/v1/admin/companies", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (_req, res, next) => { try {
    res.json({ items: await scanAll(dynamodb_js_1.tables.companies) });
}
catch (error) {
    next(error);
} });
app.patch("/v1/admin/companies/:id/compliance", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (req, res, next) => { try {
    const body = zod_1.z.object({ compliance_status: zod_1.z.enum(["pending", "compliant", "non_compliant"]), admin_notes: zod_1.z.string().max(4000) }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: "Provide a valid compliance status and notes." });
        return;
    }
    const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.companies, Key: { id: req.params.id }, UpdateExpression: "SET compliance_status=:status,admin_notes=:notes,compliance_reviewed_at=:at", ExpressionAttributeValues: { ":status": body.data.compliance_status, ":notes": body.data.admin_notes, ":at": new Date().toISOString() }, ReturnValues: "ALL_NEW" }));
    res.json({ item: result.Attributes });
}
catch (error) {
    next(error);
} });
app.patch("/v1/admin/instructors/:id/verification", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const body = zod_1.z.object({ status: zod_1.z.enum(["active", "rejected"]), notes: zod_1.z.string().max(2000).optional() }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Choose approve or reject." });
            return;
        }
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.params.id }, UpdateExpression: "SET verification_status=:status,admin_verification_notes=:notes,verification_reviewed_at=:at", ExpressionAttributeValues: { ":status": body.data.status, ":notes": body.data.notes ?? "", ":at": new Date().toISOString() }, ReturnValues: "ALL_NEW" }));
        const email = String(result.Attributes?.email ?? (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: req.params.id } }))).Item?.email ?? "");
        const message = body.data.status === "active" ? "Your instructor profile has been approved. You can now receive lesson bookings." : `Your instructor application was not approved at this time.${body.data.notes ? ` Review notes: ${body.data.notes}` : ""}`;
        await sendEmail(email, `iDriveMzansi instructor application ${body.data.status}`, message);
        await notifyUser(String(req.params.id), "verification_result", `Instructor application ${body.data.status}`, message);
        res.json({ item: result.Attributes });
    }
    catch (error) {
        next(error);
    }
});
app.delete("/v1/admin/instructors/:id", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (req, res, next) => { try {
    const id = String(req.params.id);
    const user = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id } }))).Item;
    if (!user?.email) {
        res.status(404).json({ error: "Instructor account email was not found." });
        return;
    }
    await (0, cognito_js_1.adminDeleteUser)(String(user.email));
    await Promise.all([dynamodb_js_1.docDb.send(new lib_dynamodb_1.DeleteCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: id } })), dynamodb_js_1.docDb.send(new lib_dynamodb_1.DeleteCommand({ TableName: dynamodb_js_1.tables.users, Key: { id } }))]);
    res.json({ status: "deleted", history_retained: true });
}
catch (error) {
    next(error);
} });
app.patch("/v1/admin/disputes/:id/resolve", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const body = zod_1.z.object({ refund_amount: zod_1.z.number().min(0).max(1000000), admin_notes: zod_1.z.string().max(4000) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Enter a valid refund amount and notes." });
            return;
        }
        const dispute = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.disputes, Key: { id: req.params.id } }))).Item;
        if (!dispute) {
            res.status(404).json({ error: "Dispute not found." });
            return;
        }
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: dispute.booking_id } }))).Item;
        if (!booking) {
            res.status(404).json({ error: "Booking not found." });
            return;
        }
        const refundableAmount = Number(booking.amount_charged ?? booking.total_amount ?? 0);
        if (body.data.refund_amount > refundableAmount) {
            res.status(400).json({ error: `Refund cannot exceed the paid amount of R${refundableAmount.toFixed(2)}.` });
            return;
        }
        if (body.data.refund_amount > 0) {
            if (!booking.payment_reference) {
                res.status(409).json({ error: "No payment reference is available for this refund." });
                return;
            }
            const transaction = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.paymentTransactions, Key: { id: booking.payment_reference } }))).Item;
            const ref = String(transaction?.provider_transaction_id ?? booking.payment_reference);
            await (0, paystack_js_1.paystack)("/refund", { transaction: ref, amount: (0, paystack_js_1.toMinorUnits)(body.data.refund_amount) });
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.disputes, Key: { id: dispute.id }, UpdateExpression: "SET #status=:resolved,refund_amount=:refund,admin_notes=:notes,resolved_at=:at", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":resolved": "resolved", ":refund": body.data.refund_amount, ":notes": body.data.admin_notes, ":at": new Date().toISOString() } }));
        if (body.data.refund_amount > 0)
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET refund_status=:refunded,refund_amount=:amount", ExpressionAttributeValues: { ":refunded": "refunded", ":amount": body.data.refund_amount } }));
        const learner = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: booking.learner_id } }))).Item;
        const message = `Your dispute for booking ${booking.id} has been resolved. Refund: R${body.data.refund_amount.toFixed(2)}. ${body.data.admin_notes}`;
        await sendEmail(String(learner?.email ?? ""), "Your iDriveMzansi dispute has been resolved", message);
        await notifyUser(String(booking.learner_id), "dispute_resolved", "Dispute resolved", message, { booking_id: booking.id });
        res.json({ status: "resolved" });
    }
    catch (error) {
        next(error);
    }
});
app.patch("/v1/admin/instructors/:id/commission", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const body = zod_1.z.object({ commissionPercent: zod_1.z.number().min(0).max(50) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Commission must be between 0 and 50 percent" });
            return;
        }
        const result = await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.params.id }, UpdateExpression: "SET commission_rate = :percent", ExpressionAttributeValues: { ":percent": body.data.commissionPercent }, ReturnValues: "ALL_NEW" }));
        res.json({ item: result.Attributes });
    }
    catch (error) {
        next(error);
    }
});
app.get("/v1/admin/instructors/:id/document-links", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (req, res, next) => { try {
    const row = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.params.id } }))).Item;
    if (!row) {
        res.status(404).json({ error: "Instructor not found." });
        return;
    }
    const links = {};
    for (const [name, key] of Object.entries(row.documents ?? {})) {
        if (typeof key === "string" && key.startsWith(`private/${req.params.id}/`))
            links[name] = await (0, s3_request_presigner_1.getSignedUrl)(s3_js_1.s3, new client_s3_1.GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), { expiresIn: 600 });
    }
    res.json({ links, verification: row.document_verification ?? {} });
}
catch (error) {
    next(error);
} });
app.post("/v1/admin/payments/payout-batches", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (req, res, next) => { try {
    const body = zod_1.z.object({ booking_ids: zod_1.z.array(zod_1.z.string().min(1)).min(1).max(100) }).safeParse(req.body);
    if (!body.success) {
        res.status(400).json({ error: "Select one or more eligible bookings." });
        return;
    }
    const id = `batch-${(0, node_crypto_1.randomUUID)()}`;
    let processed = 0, skipped = 0, total = 0, deductions = 0;
    for (const bookingId of [...new Set(body.data.booking_ids)]) {
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: bookingId } }))).Item;
        if (!booking || booking.status !== "completed" || booking.instructor_marked_complete !== true || booking.learner_confirmed_complete !== true || booking.payment_status !== "paid" || booking.payout_status === "completed") {
            skipped++;
            continue;
        }
        total += Number(booking.instructor_payout ?? 0);
        deductions += Number(booking.platform_fee ?? 0);
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET payout_status=:failed", ConditionExpression: "payout_status=:failed OR attribute_not_exists(payout_status)", ExpressionAttributeValues: { ":failed": "failed" } }));
        await releaseBookingPayout(booking.id);
        processed++;
    }
    const item = { id, kind: "batch", status: "processing", booking_ids: [...new Set(body.data.booking_ids)], processed, skipped, instructor_payout_total: total, platform_fee_deductions: deductions, currency: "ZAR", created_at: new Date().toISOString() };
    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.payouts, Item: item }));
    res.status(201).json({ item });
}
catch (error) {
    next(error);
} });
app.get("/v1/admin/payments", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (_req, res, next) => {
    try {
        const [bookings, payments, payouts] = await Promise.all([scanAll(dynamodb_js_1.tables.bookings), scanAll(dynamodb_js_1.tables.paymentTransactions), scanAll(dynamodb_js_1.tables.payouts)]);
        res.json({ transactions: bookings.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))), paymentTransactions: payments.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))), payouts: payouts.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))), currency: "ZAR" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/admin/payments/payouts/:id/process", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const payout = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: req.params.id } }))).Item;
        if (!payout) {
            res.status(404).json({ error: "Payout not found." });
            return;
        }
        if (payout.status === "completed") {
            res.json({ status: "completed", idempotent: true });
            return;
        }
        if (payout.admin_manual === true) {
            if (payout.status !== "failed") {
                res.status(409).json({ error: "Only failed manual payouts can be retried." });
                return;
            }
            const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: payout.instructor_id } }))).Item;
            if (!instructor) {
                res.status(404).json({ error: "Instructor not found." });
                return;
            }
            const recipient = await instructorOrCompanyRecipient(instructor);
            const reference = String(payout.paystack_reference ?? `mdp-${payout.id}`);
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: payout.id }, UpdateExpression: "SET #status=:processing,paystack_reference=:reference", ConditionExpression: "#status=:failed", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":processing": "processing", ":reference": reference, ":failed": "failed" } }));
            const transfer = await (0, paystack_js_1.paystack)("/transfer", { source: "balance", amount: (0, paystack_js_1.toMinorUnits)(Number(payout.amount)), recipient: recipient.code, reason: String(payout.reason ?? "Admin payout retry"), reference, currency: "ZAR" });
            const status = transfer.status === "otp" ? "awaiting_otp" : "processing";
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: payout.id }, UpdateExpression: "SET #status=:status,paystack_transfer_code=:code", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":status": status, ":code": transfer.transfer_code } }));
            res.json({ status });
            return;
        }
        if (!payout.booking_id) {
            res.status(409).json({ error: "This payout has no verified lesson completion." });
            return;
        }
        const booking = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: payout.booking_id } }))).Item;
        if (!booking || booking.instructor_marked_complete !== true || booking.learner_confirmed_complete !== true || booking.payment_status !== "paid") {
            res.status(409).json({ error: "Both learner and instructor completion confirmations are required." });
            return;
        }
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: booking.id }, UpdateExpression: "SET payout_status=:failed", ConditionExpression: "payout_status=:failed OR attribute_not_exists(payout_status)", ExpressionAttributeValues: { ":failed": "failed" } }));
        await releaseBookingPayout(booking.id);
        res.json({ status: "processing" });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/admin/payments/manual-payout", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const body = zod_1.z.object({ instructorId: zod_1.z.string().min(1), amount: zod_1.z.number().positive().max(1000000), reason: zod_1.z.string().trim().min(3).max(240) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Enter a valid instructor, amount, and reason." });
            return;
        }
        const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: body.data.instructorId } }))).Item;
        if (!instructor) {
            res.status(404).json({ error: "Instructor not found." });
            return;
        }
        const recipient = await instructorOrCompanyRecipient(instructor);
        const id = `manual-${(0, node_crypto_1.randomUUID)()}`;
        const reference = `mdp-${id}`;
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.payouts, Item: { id, instructor_id: body.data.instructorId, payee_id: recipient.targetId, payee_type: instructor.company_id ? "company" : "instructor", amount: body.data.amount, status: "processing", schedule: "weekly", created_at: new Date().toISOString(), admin_manual: true, reason: body.data.reason, paystack_reference: reference } }));
        let transfer;
        try {
            transfer = await (0, paystack_js_1.paystack)("/transfer", { source: "balance", amount: (0, paystack_js_1.toMinorUnits)(body.data.amount), recipient: recipient.code, reason: body.data.reason, reference, currency: "ZAR" });
        }
        catch (error) {
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id }, UpdateExpression: "SET #status=:failed,payout_error=:error", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":failed": "failed", ":error": "Transfer initiation failed" } }));
            throw error;
        }
        const status = transfer.status === "otp" ? "awaiting_otp" : "processing";
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id }, UpdateExpression: "SET #status=:status,paystack_transfer_code=:code", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":status": status, ":code": transfer.transfer_code } }));
        res.status(201).json({ id, status, amount: body.data.amount, currency: "ZAR", payee: recipient.name });
    }
    catch (error) {
        next(error);
    }
});
app.post("/v1/admin/payments/payouts/:id/finalize", auth_js_1.requireAuth, (0, auth_js_1.requireRole)("admin"), async (req, res, next) => {
    try {
        const body = zod_1.z.object({ otp: zod_1.z.string().trim().min(4).max(10) }).safeParse(req.body);
        if (!body.success) {
            res.status(400).json({ error: "Enter the Paystack transfer OTP." });
            return;
        }
        const payout = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: req.params.id } }))).Item;
        if (!payout?.paystack_transfer_code || payout.status !== "awaiting_otp") {
            res.status(409).json({ error: "This payout is not waiting for transfer authorization." });
            return;
        }
        const result = await (0, paystack_js_1.paystack)("/transfer/finalize_transfer", { transfer_code: payout.paystack_transfer_code, otp: body.data.otp });
        const status = result.status === "success" ? "completed" : "processing";
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.payouts, Key: { id: payout.id }, UpdateExpression: "SET #status=:status,transfer_finalized_at=:at", ExpressionAttributeNames: { "#status": "status" }, ExpressionAttributeValues: { ":status": status, ":at": new Date().toISOString() } }));
        if (payout.booking_id && status === "completed")
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.bookings, Key: { id: payout.booking_id }, UpdateExpression: "SET payout_status=:status", ExpressionAttributeValues: { ":status": status } }));
        if (status === "completed" && payout.instructor_id) {
            const instructor = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: payout.instructor_id } }))).Item;
            const user = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.users, Key: { id: payout.instructor_id } }))).Item;
            await sendEmail(String(instructor?.email ?? user?.email ?? ""), "iDriveMzansi payout processed", `Your payout of R${Number(payout.amount ?? 0).toFixed(2)} has been processed.`);
        }
        res.json({ status });
    }
    catch (error) {
        next(error);
    }
});
// Authenticated AI routes. Inputs and model outputs are both checked against contracts.
const aiRole = {
    bio: "instructor",
    "student-assessment": "instructor", "instructor-coach": "instructor",
    "k53-questions": "learner", "k53-analysis": "learner", "smart-recommendations": "learner",
    "marketing-content": "instructor", "availability-optimizer": "instructor",
    "pricing-suggestion": "instructor",
};
const aiTasks = Object.keys(ai_contracts_js_1.aiInputs);
for (const task of aiTasks) {
    const guards = [auth_js_1.requireAuth];
    const role = aiRole[task];
    if (role)
        guards.push((0, auth_js_1.requireRole)(role));
    if (task === "generate-lesson-plan")
        guards.push((req, res, next) => {
            if (req.auth.role === "learner")
                return requireLearnerComplete(req, res, next);
            if (req.auth.role === "instructor")
                return requireInstructorComplete(req, res, next);
            res.status(403).json({ error: "Learner or instructor access required." });
        });
    if (task === "student-assessment" || task === "instructor-coach" || task === "marketing-content" || task === "availability-optimizer")
        guards.push(requireInstructorComplete);
    if (task === "k53-questions" || task === "k53-analysis" || task === "smart-recommendations")
        guards.push(requireLearnerComplete);
    app.post(`/ai/${task}`, ...guards, async (req, res, next) => {
        try {
            const parsed = ai_contracts_js_1.aiInputs[task].safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({ error: "Invalid AI request", details: parsed.error.flatten() });
                return;
            }
            let payload = parsed.data;
            let verifiedDocumentKey;
            if (task === "smart-recommendations") {
                const active = await scanAll(dynamodb_js_1.tables.instructors);
                payload = { learner_preferences: payload.learner_preferences, active_instructors: active.filter(i => i.verification_status === "active").map(publicInstructor) };
            }
            if (task === "document-verify") {
                if (req.auth.role !== "learner" && req.auth.role !== "instructor") {
                    res.status(403).json({ error: "Forbidden" });
                    return;
                }
                const documentTypes = ["identity", "learner_licence", "instructor_licence", "vehicle_licence", "instructor_certificate", "vehicle_roadworthy", "police_clearance", "vehicle_insurance", "professional_liability_insurance", "other"];
                const body = zod_1.z.object({ document_type: zod_1.z.enum(documentTypes), s3_url: zod_1.z.string().min(1).max(2048) }).safeParse(req.body);
                if (!body.success) {
                    res.status(400).json({ error: "Provide a document type and S3 object URL." });
                    return;
                }
                const bucket = process.env.S3_BUCKET;
                if (!bucket) {
                    res.status(503).json({ error: "Private document storage is not configured." });
                    return;
                }
                let key = body.data.s3_url;
                if (/^https?:\/\//i.test(key)) {
                    try {
                        const url = new URL(key);
                        if (!url.hostname.startsWith(`${bucket}.s3.`) && url.hostname !== `${bucket}.s3.amazonaws.com` && url.hostname !== `${bucket}.s3.${process.env.AWS_REGION ?? "af-south-1"}.amazonaws.com`) {
                            res.status(400).json({ error: "Document URL must belong to the configured private bucket." });
                            return;
                        }
                        key = decodeURIComponent(url.pathname.replace(/^\//, ""));
                    }
                    catch {
                        res.status(400).json({ error: "Invalid S3 object URL." });
                        return;
                    }
                }
                const docCategory = { instructor_certificate: "instructor-certificate", instructor_licence: "driver-licence", vehicle_roadworthy: "vehicle-roadworthy", identity: "sa-id", police_clearance: "police-clearance", vehicle_insurance: "vehicle-insurance", professional_liability_insurance: "professional-liability-insurance" };
                if (!key.startsWith(`private/${req.auth.sub}/`) || (req.auth.role === "instructor" && docCategory[body.data.document_type] && !key.startsWith(`private/${req.auth.sub}/${docCategory[body.data.document_type]}/`))) {
                    res.status(403).json({ error: "You can only verify your own uploaded document in its matching category." });
                    return;
                }
                verifiedDocumentKey = key;
                const object = await s3_js_1.s3.send(new client_s3_1.GetObjectCommand({ Bucket: bucket, Key: key }));
                if (!object.Body || !object.ContentLength || object.ContentLength > 12 * 1024 * 1024) {
                    res.status(400).json({ error: "Document must be uploaded and no larger than 12 MB." });
                    return;
                }
                const mimeType = object.ContentType ?? "";
                if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(mimeType)) {
                    res.status(400).json({ error: "Unsupported document type." });
                    return;
                }
                const bytes = await object.Body.transformToByteArray();
                const profileTable = req.auth.role === "learner" ? dynamodb_js_1.tables.learners : dynamodb_js_1.tables.instructors;
                const storedProfile = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: profileTable, Key: { user_id: req.auth.sub } }))).Item ?? {};
                const profile = { full_name: storedProfile.full_name, city: storedProfile.city, experience_years: storedProfile.experience_years };
                payload = { document_type: body.data.document_type, document_base64: Buffer.from(bytes).toString("base64"), mime_type: mimeType, instructor_profile: profile };
            }
            const result = await (0, modal_js_1.infer)(task, payload);
            const valid = ai_contracts_js_1.aiOutputs[task].safeParse(result);
            if (!valid.success) {
                console.error(`Invalid Modal response for ${task}`, valid.error.flatten());
                res.status(502).json({ error: "AI provider returned an invalid response." });
                return;
            }
            if (task === "k53-questions" && Array.isArray(valid.data) && valid.data.length !== parsed.data.count) {
                res.status(502).json({ error: "AI provider returned the wrong number of questions." });
                return;
            }
            if (task === "document-verify" && req.auth.role === "instructor") {
                const body = parsed.data;
                const category = { instructor_certificate: "instructor_certificate", instructor_licence: "driver_licence", vehicle_roadworthy: "vehicle_roadworthy", identity: "sa_id", police_clearance: "police_clearance", vehicle_insurance: "vehicle_insurance", professional_liability_insurance: "professional_liability_insurance" };
                const type = body.document_type;
                if (category[type]) {
                    const old = (await dynamodb_js_1.docDb.send(new lib_dynamodb_1.GetCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub } }))).Item ?? {};
                    await dynamodb_js_1.docDb.send(new lib_dynamodb_1.UpdateCommand({ TableName: dynamodb_js_1.tables.instructors, Key: { user_id: req.auth.sub }, UpdateExpression: "SET documents=:documents,document_verification=:verification", ExpressionAttributeValues: { ":documents": { ...(old.documents ?? {}), [category[type]]: verifiedDocumentKey }, ":verification": { ...(old.document_verification ?? {}), [category[type]]: valid.data } } }));
                }
            }
            if (task === "k53-analysis") {
                const input = parsed.data;
                const correct = input.questions.reduce((count, question, index) => count + (question.correct_index === input.learner_answers[index] ? 1 : 0), 0);
                const weak = valid.data.weak_categories;
                await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.k53TestResults, Item: { id: (0, node_crypto_1.randomUUID)(), learner_id: req.auth.sub, test_type: String(req.body.test_type ?? "K53 practice"), difficulty: String(req.body.difficulty ?? "adaptive"), score: Math.round(correct / Math.max(1, input.questions.length) * 100), pass: correct / Math.max(1, input.questions.length) >= 0.8, weak_categories: weak, time_taken: Number(req.body.time_taken ?? 0), created_at: new Date().toISOString() } }));
            }
            if (req.auth.role === "instructor" && ["generate-lesson-plan", "student-assessment", "instructor-coach", "marketing-content", "availability-optimizer", "pricing-suggestion"].includes(task))
                await awardInstructorPoints(req.auth.sub, `Completed ${task.replaceAll("-", " ")} AI task`, 5);
            res.json(valid.data);
        }
        catch (error) {
            next(error);
        }
    });
}
app.use((err, _req, res, _next) => {
    console.error("API request failed", err);
    const name = typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
    if (["NotAuthorizedException", "UserNotConfirmedException", "CodeMismatchException", "ExpiredCodeException", "UserNotFoundException", "UsernameExistsException", "InvalidPasswordException", "InvalidParameterException"].includes(name)) {
        res.status(name === "NotAuthorizedException" ? 401 : 400).json({ error: name === "NotAuthorizedException" ? "Email or password is incorrect." : "Cognito could not complete this request. Check your details and verification code." });
        return;
    }
    if (name === "TooManyRequestsException" || name === "LimitExceededException") {
        res.status(429).json({ error: "Too many attempts. Please wait and try again." });
        return;
    }
    if (name === "Error" && String(err.message).includes("Paystack is not configured")) {
        res.status(503).json({ error: "Paystack is not configured on the API." });
        return;
    }
    if (name === "Error" && String(err.message).includes("Cognito is not configured")) {
        res.status(503).json({ error: "Cognito is not configured on the API." });
        return;
    }
    if (name === "Error" && String(err.message).includes("Modal inference endpoint is not configured")) {
        res.status(503).json({ error: "Modal AI is not configured on the API." });
        return;
    }
    if (name === "Error" && String(err.message).startsWith("Modal inference request failed")) {
        res.status(502).json({ error: "Modal AI request failed." });
        return;
    }
    res.status(500).json({ error: "Unexpected server error" });
});
app.listen(Number(process.env.PORT ?? 4000), () => console.log("iDriveMzansi API listening"));
