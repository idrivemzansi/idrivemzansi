# WebSocket deployment

Deploy `template.yaml` with the Cognito pool id, DynamoDB table prefix, and an S3 zip containing the compiled `websocket.js`, the API `services/` modules, and production dependencies. Set the Express API's `API_GATEWAY_WEBSOCKET_URL` to the `WebSocketUrl` output and `WEBSOCKET_MANAGEMENT_ENDPOINT` to `ManagementEndpoint`. The existing notifications table is used to retain connection ids; no extra table is needed.

Clients request `/v1/realtime/config` through the authenticated Next.js backend proxy. The short-lived Cognito access token is held in memory while the WebSocket connects. The `$connect` Lambda validates it before recording the connection. Chat continues to use the REST API as a reconnect fallback.
