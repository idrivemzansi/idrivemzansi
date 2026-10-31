"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientId = exports.userPoolId = exports.cognitoClient = void 0;
exports.roleFromClaims = roleFromClaims;
exports.verifyIdToken = verifyIdToken;
exports.verifyAccessToken = verifyAccessToken;
exports.confirmRoleGroup = confirmRoleGroup;
exports.adminDeleteUser = adminDeleteUser;
exports.signup = signup;
exports.confirmSignup = confirmSignup;
exports.authenticate = authenticate;
exports.refreshTokens = refreshTokens;
exports.resendCode = resendCode;
exports.signOut = signOut;
const client_cognito_identity_provider_1 = require("@aws-sdk/client-cognito-identity-provider");
const aws_jwt_verify_1 = require("aws-jwt-verify");
const region = process.env.AWS_REGION ?? "af-south-1";
exports.cognitoClient = new client_cognito_identity_provider_1.CognitoIdentityProviderClient({ region });
exports.userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";
exports.clientId = process.env.COGNITO_CLIENT_ID ?? "";
let idVerifier;
let accessVerifier;
function ensureConfig() {
    if (!exports.userPoolId || !exports.clientId)
        throw new Error("Cognito is not configured");
}
function roleFromClaims(claims) {
    const groups = Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] : [];
    if (groups.includes("admin"))
        return "admin";
    if (groups.includes("instructor"))
        return "instructor";
    if (groups.includes("learner"))
        return "learner";
    return null;
}
async function verifyIdToken(token) {
    ensureConfig();
    idVerifier ??= aws_jwt_verify_1.CognitoJwtVerifier.create({ userPoolId: exports.userPoolId, clientId: exports.clientId, tokenUse: "id" });
    const claims = await idVerifier.verify(token);
    const role = roleFromClaims(claims);
    if (!role || !claims.sub)
        throw new Error("Account does not have an assigned iDriveMzansi role");
    return { ...claims, sub: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined, role, groups: Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] : [] };
}
async function verifyAccessToken(token) {
    ensureConfig();
    accessVerifier ??= aws_jwt_verify_1.CognitoJwtVerifier.create({ userPoolId: exports.userPoolId, clientId: exports.clientId, tokenUse: "access" });
    const claims = await accessVerifier.verify(token);
    const role = roleFromClaims(claims);
    if (!role || !claims.sub)
        throw new Error("Account does not have an assigned iDriveMzansi role");
    return { ...claims, sub: claims.sub, email: typeof claims.username === "string" ? claims.username : undefined, role, groups: Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] : [] };
}
async function confirmRoleGroup(email, role) {
    ensureConfig();
    await exports.cognitoClient.send(new client_cognito_identity_provider_1.AdminAddUserToGroupCommand({ UserPoolId: exports.userPoolId, Username: email, GroupName: role }));
}
async function adminDeleteUser(username) {
    ensureConfig();
    await exports.cognitoClient.send(new client_cognito_identity_provider_1.AdminDeleteUserCommand({ UserPoolId: exports.userPoolId, Username: username }));
}
async function signup(email, password, role, phone) {
    ensureConfig();
    return exports.cognitoClient.send(new client_cognito_identity_provider_1.SignUpCommand({
        ClientId: exports.clientId, Username: email, Password: password,
        UserAttributes: [{ Name: "email", Value: email }, { Name: "phone_number", Value: phone }, { Name: "custom:user_type", Value: role }],
    }));
}
async function confirmSignup(email, code) {
    ensureConfig();
    await exports.cognitoClient.send(new client_cognito_identity_provider_1.ConfirmSignUpCommand({ ClientId: exports.clientId, Username: email, ConfirmationCode: code }));
    const user = await exports.cognitoClient.send(new client_cognito_identity_provider_1.AdminGetUserCommand({ UserPoolId: exports.userPoolId, Username: email }));
    const sub = user.UserAttributes?.find(item => item.Name === "sub")?.Value;
    const requestedRole = user.UserAttributes?.find(item => item.Name === "custom:user_type")?.Value;
    if (requestedRole !== "learner" && requestedRole !== "instructor")
        throw new Error("Signup role is not valid");
    if (!sub)
        throw new Error("Verified account does not have a user id");
    await confirmRoleGroup(email, requestedRole);
    return { sub, role: requestedRole };
}
async function authenticate(email, password) {
    ensureConfig();
    const result = await exports.cognitoClient.send(new client_cognito_identity_provider_1.InitiateAuthCommand({
        ClientId: exports.clientId, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: email, PASSWORD: password },
    }));
    if (!result.AuthenticationResult?.AccessToken || !result.AuthenticationResult.IdToken || !result.AuthenticationResult.RefreshToken) {
        throw new Error("Cognito returned a challenge; this account needs additional verification.");
    }
    const claims = await verifyIdToken(result.AuthenticationResult.IdToken);
    return { tokens: result.AuthenticationResult, claims };
}
async function refreshTokens(refreshToken) {
    ensureConfig();
    const result = await exports.cognitoClient.send(new client_cognito_identity_provider_1.InitiateAuthCommand({
        ClientId: exports.clientId, AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: refreshToken },
    }));
    if (!result.AuthenticationResult?.AccessToken || !result.AuthenticationResult.IdToken)
        throw new Error("Cognito could not refresh this session");
    const claims = await verifyIdToken(result.AuthenticationResult.IdToken);
    return { tokens: result.AuthenticationResult, claims };
}
async function resendCode(email) {
    ensureConfig();
    return exports.cognitoClient.send(new client_cognito_identity_provider_1.ResendConfirmationCodeCommand({ ClientId: exports.clientId, Username: email }));
}
async function signOut(accessToken, refreshToken) {
    ensureConfig();
    await exports.cognitoClient.send(new client_cognito_identity_provider_1.GlobalSignOutCommand({ AccessToken: accessToken }));
    if (refreshToken) {
        try {
            await exports.cognitoClient.send(new client_cognito_identity_provider_1.RevokeTokenCommand({ ClientId: exports.clientId, Token: refreshToken }));
        }
        catch (error) {
            console.warn("Cognito refresh-token revocation failed after global sign-out", error);
        }
    }
}
