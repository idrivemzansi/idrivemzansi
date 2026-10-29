import json
import os
import urllib.error
import urllib.request


def post(path):
    request = urllib.request.Request(
        os.environ["API_URL"].rstrip("/") + path,
        data=b"{}",
        headers={
            "content-type": "application/json",
            "x-reminder-token": os.environ["REMINDER_TOKEN"],
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return {"statusCode": response.status, "body": payload}
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"API returned {error.code} for {path}") from error


def handler(event, context):
    return post("/v1/internal/reminders/process")


def enatis_expiry_handler(event, context):
    return post("/v1/internal/enatis/expire")
