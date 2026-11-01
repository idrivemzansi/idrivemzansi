Deploy from this folder with AWS SAM after setting the API URL and a secret token shared with the API:

    sam deploy --guided

Set the API environment variable `EVENTBRIDGE_REMINDER_TOKEN` to the same secret. The EventBridge schedule calls the protected reminder processor every five minutes. The API sends lesson reminder email with SES when `SES_FROM_EMAIL` is configured.

The same stack also deploys `EnatisSlotExpiry`, which calls `POST /v1/internal/enatis/expire` once a day with the same token so stale eNaTIS slots are swept even if the API's own in-process interval never runs (after a long downtime, for example).
