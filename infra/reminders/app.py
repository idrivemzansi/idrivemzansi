import json
import os
import urllib.error
import urllib.request


def handler(event, context):
    request = urllib.request.Request(
        os.environ["API_URL"].rstrip("/") + "/v1/internal/reminders/process",
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
        raise RuntimeError(f"Reminder API returned {error.code}") from error
