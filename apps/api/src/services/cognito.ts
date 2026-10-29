import {
  AdminAddUserToGroupCommand,
  AdminGetUserCommand,
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  ConfirmSignUpCommand,
  GlobalSignOutCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RevokeTokenCommand,
  SignUpCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoJwtVerifier } from "aws-jwt-verify";

const region = process.env.AWS_REGION ?? "af-south-1";
export const cognitoClient = new CognitoIdentityProviderClient({ region });
export const userPoolId = process.env.COGNITO_USER_POOL_ID ?? "";
export const clientId = process.env.COGNITO_CLIENT_ID ?? "";
let idVerifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;
let accessVerifier: ReturnType<typeof CognitoJwtVerifier.create> | undefined;
function ensureConfig() {
  if (!userPoolId || !clientId) throw new Error("Cognito is not configured");
}

export type AppRole = "learner" | "instructor" | "admin";
export type AppClaims = { sub: string; email?: string; role: AppRole; groups: string[]; [key: string]: unknown };

export function roleFromClaims(claims: Record<string, unknown>): AppRole | null {
  const groups = Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] as string[] : [];
  if (groups.includes("admin")) return "admin";
  if (groups.includes("instructor")) return "instructor";
  if (groups.includes("learner")) return "learner";
  return null;
}

export async function verifyIdToken(token: string): Promise<AppClaims> {
  ensureConfig();
  idVerifier ??= CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: "id" });
  const claims = await idVerifier.verify(token);
  const role = roleFromClaims(claims as Record<string, unknown>);
  if (!role || !claims.sub) throw new Error("Account does not have an assigned iDriveMzansi role");
  return { ...claims, sub: claims.sub, email: typeof claims.email === "string" ? claims.email : undefined, role, groups: Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] as string[] : [] };
}

export async function verifyAccessToken(token: string): Promise<AppClaims> {
  ensureConfig();
  accessVerifier ??= CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: "access" });
  const claims = await accessVerifier.verify(token);
  const role = roleFromClaims(claims as Record<string, unknown>);
  if (!role || !claims.sub) throw new Error("Account does not have an assigned iDriveMzansi role");
  return { ...claims, sub: claims.sub, email: typeof claims.username === "string" ? claims.username : undefined, role, groups: Array.isArray(claims["cognito:groups"]) ? claims["cognito:groups"] as string[] : [] };
}

export async function confirmRoleGroup(email: string, role: "learner" | "instructor") {
  ensureConfig();
  await cognitoClient.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: email, GroupName: role }));
}

export async function adminDeleteUser(username: string) {
  ensureConfig();
  await cognitoClient.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
}

export async function signup(email: string, password: string, role: "learner" | "instructor", phone: string) {
  ensureConfig();
  return cognitoClient.send(new SignUpCommand({
    ClientId: clientId, Username: email, Password: password,
    UserAttributes: [{ Name: "email", Value: email }, { Name: "phone_number", Value: phone }, { Name: "custom:user_type", Value: role }],
  }));
}

export async function confirmSignup(email: string, code: string) {
  ensureConfig();
  await cognitoClient.send(new ConfirmSignUpCommand({ ClientId: clientId, Username: email, ConfirmationCode: code }));
  const user = await cognitoClient.send(new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }));
  const sub = user.UserAttributes?.find(item => item.Name === "sub")?.Value;
  const requestedRole = user.UserAttributes?.find(item => item.Name === "custom:user_type")?.Value;
  if (requestedRole !== "learner" && requestedRole !== "instructor") throw new Error("Signup role is not valid");
  if (!sub) throw new Error("Verified account does not have a user id");
  await confirmRoleGroup(email, requestedRole);
  return { sub, role: requestedRole };
}

export async function authenticate(email: string, password: string) {
  ensureConfig();
  const result = await cognitoClient.send(new InitiateAuthCommand({
    ClientId: clientId, AuthFlow: "USER_PASSWORD_AUTH", AuthParameters: { USERNAME: email, PASSWORD: password },
  }));
  if (!result.AuthenticationResult?.AccessToken || !result.AuthenticationResult.IdToken || !result.AuthenticationResult.RefreshToken) {
    throw new Error("Cognito returned a challenge; this account needs additional verification.");
  }
  const claims = await verifyIdToken(result.AuthenticationResult.IdToken);
  return { tokens: result.AuthenticationResult, claims };
}

export async function refreshTokens(refreshToken: string) {
  ensureConfig();
  const result = await cognitoClient.send(new InitiateAuthCommand({
    ClientId: clientId, AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: refreshToken },
  }));
  if (!result.AuthenticationResult?.AccessToken || !result.AuthenticationResult.IdToken) throw new Error("Cognito could not refresh this session");
  const claims = await verifyIdToken(result.AuthenticationResult.IdToken);
  return { tokens: result.AuthenticationResult, claims };
}

export async function resendCode(email: string) {
  ensureConfig();
  return cognitoClient.send(new ResendConfirmationCodeCommand({ ClientId: clientId, Username: email }));
}

export async function signOut(accessToken: string, refreshToken?: string) {
  ensureConfig();
  await cognitoClient.send(new GlobalSignOutCommand({ AccessToken: accessToken }));
  if (refreshToken) {
    try { await cognitoClient.send(new RevokeTokenCommand({ ClientId: clientId, Token: refreshToken })); }
    catch (error) { console.warn("Cognito refresh-token revocation failed after global sign-out", error); }
  }
}
