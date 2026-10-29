Deploy from this folder with AWS SAM after setting the API URL and a secret token shared with the API:

    sam deploy --guided

Set the API environment variable `EVENTBRIDGE_REMINDER_TOKEN` to the same secret. The EventBridge schedule calls the protected reminder processor every five minutes. The API sends lesson reminder email with SES and SMS with Twilio when the relevant credentials are configured.
