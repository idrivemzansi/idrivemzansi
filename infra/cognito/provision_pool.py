"""Provision the iDriveMzansi Cognito user pool, app client, and role groups.

Uses Cognito's built-in email code verification and creates a public, no-secret
app client for the server-mediated web and mobile auth flows.
"""
import json
import os
import subprocess

REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "af-south-1"))
POOL_NAME = os.getenv("COGNITO_POOL_NAME", "mzansidrive-users")
CLIENT_NAME = os.getenv("COGNITO_CLIENT_NAME", "mzansidrive-web-mobile")


def aws(*args):
    result = subprocess.run(["aws", *args, "--region", REGION, "--output", "json"], check=True, capture_output=True, text=True)
    return json.loads(result.stdout) if result.stdout.strip() else {}


def main():
    pools = aws("cognito-idp", "list-user-pools", "--max-results", "60").get("UserPools", [])
    pool = next((p for p in pools if p["Name"] == POOL_NAME), None)
    if pool:
        pool_id = pool["Id"]
        print("Using existing pool " + pool_id, flush=True)
    else:
        config = {
            "PoolName": POOL_NAME,
            "UsernameAttributes": ["email"],
            "AutoVerifiedAttributes": ["email"],
            "EmailConfiguration": {"EmailSendingAccount": "COGNITO_DEFAULT"},
            "VerificationMessageTemplate": {
                "DefaultEmailOption": "CONFIRM_WITH_CODE",
                "EmailSubject": "Your iDriveMzansi verification code",
                "EmailMessage": "Your iDriveMzansi verification code is {####}",
            },
            "Policies": {"PasswordPolicy": {
                "MinimumLength": 12,
                "RequireUppercase": True,
                "RequireLowercase": True,
                "RequireNumbers": True,
                "RequireSymbols": True,
                "TemporaryPasswordValidityDays": 7,
            }},
            "Schema": [{"Name": "user_type", "AttributeDataType": "String", "Mutable": True, "Required": False}],
        }
        path = "infra/cognito/user-pool.json"
        with open(path, "w", encoding="utf-8") as target:
            json.dump(config, target, indent=2)
        pool_id = aws("cognito-idp", "create-user-pool", "--cli-input-json", "file://" + path)["UserPool"]["Id"]
        os.remove(path)
        print("Created pool " + pool_id, flush=True)

    clients = aws("cognito-idp", "list-user-pool-clients", "--user-pool-id", pool_id, "--max-results", "60").get("UserPoolClients", [])
    client = next((c for c in clients if c["ClientName"] == CLIENT_NAME), None)
    if client:
        client_id = client["ClientId"]
        print("Using existing app client " + client_id, flush=True)
    else:
        client_config = {
            "UserPoolId": pool_id,
            "ClientName": CLIENT_NAME,
            "GenerateSecret": False,
            "ExplicitAuthFlows": ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"],
            "PreventUserExistenceErrors": "ENABLED",
            "AccessTokenValidity": 60,
            "IdTokenValidity": 60,
            "RefreshTokenValidity": 30,
            "TokenValidityUnits": {"AccessToken": "minutes", "IdToken": "minutes", "RefreshToken": "days"},
        }
        with open("infra/cognito/app-client.json", "w", encoding="utf-8") as target:
            json.dump(client_config, target, indent=2)
        client_id = aws("cognito-idp", "create-user-pool-client", "--cli-input-json", "file://infra/cognito/app-client.json")["UserPoolClient"]["ClientId"]
        os.remove("infra/cognito/app-client.json")
        print("Created app client " + client_id, flush=True)

    groups = aws("cognito-idp", "list-groups", "--user-pool-id", pool_id, "--limit", "60").get("Groups", [])
    existing = {group["GroupName"] for group in groups}
    for role in ("learner", "instructor", "admin"):
        if role not in existing:
            aws("cognito-idp", "create-group", "--user-pool-id", pool_id, "--group-name", role)
            print("Created role group " + role, flush=True)
    print(json.dumps({"region": REGION, "userPoolId": pool_id, "clientId": client_id, "groups": ["learner", "instructor", "admin"]}, indent=2), flush=True)


if __name__ == "__main__":
    main()
