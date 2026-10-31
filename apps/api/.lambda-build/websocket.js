"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = handler;
const client_apigatewaymanagementapi_1 = require("@aws-sdk/client-apigatewaymanagementapi");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const dynamodb_js_1 = require("./services/dynamodb.js");
const cognito_js_1 = require("./services/cognito.js");
const response = (statusCode, body = "") => ({ statusCode, body });
/** Configure API Gateway WebSocket routes $connect/$disconnect/$default to this Lambda.
 * The $connect Lambda validates the Cognito access token before retaining the connection.
 */
async function handler(event) {
    const { routeKey, connectionId, domainName, stage } = event.requestContext;
    if (!connectionId)
        return response(400, "Missing connection id");
    if (routeKey === "$connect") {
        const token = event.queryStringParameters?.token;
        if (!token)
            return response(401, "Missing access token");
        try {
            const claims = await (0, cognito_js_1.verifyAccessToken)(token);
            await dynamodb_js_1.docDb.send(new lib_dynamodb_1.PutCommand({ TableName: dynamodb_js_1.tables.notifications, Item: { id: `ws-${connectionId}`, user_id: claims.sub, connection_id: connectionId, type: "ws_connection", created_at: new Date().toISOString(), expires_at: Math.floor(Date.now() / 1000) + 3600 } }));
            return response(200, "Connected");
        }
        catch {
            return response(401, "Invalid access token");
        }
    }
    if (routeKey === "$disconnect") {
        await dynamodb_js_1.docDb.send(new lib_dynamodb_1.DeleteCommand({ TableName: dynamodb_js_1.tables.notifications, Key: { id: `ws-${connectionId}` } })).catch(() => undefined);
        return response(200, "Disconnected");
    }
    const endpoint = process.env.WEBSOCKET_MANAGEMENT_ENDPOINT ?? `https://${domainName}/${stage}`;
    const client = new client_apigatewaymanagementapi_1.ApiGatewayManagementApiClient({ endpoint, region: process.env.AWS_REGION ?? "af-south-1" });
    try {
        const body = JSON.parse(event.body ?? "{}");
        if (body.action === "ping")
            await client.send(new client_apigatewaymanagementapi_1.PostToConnectionCommand({ ConnectionId: connectionId, Data: Buffer.from(JSON.stringify({ type: "pong", at: new Date().toISOString() })) }));
        return response(200, "OK");
    }
    catch {
        return response(400, "Invalid message");
    }
}
