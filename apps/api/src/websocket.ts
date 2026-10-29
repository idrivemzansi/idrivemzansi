import { ApiGatewayManagementApiClient, PostToConnectionCommand } from "@aws-sdk/client-apigatewaymanagementapi";
import { DeleteCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { docDb, tables } from "./services/dynamodb.js";
import { verifyAccessToken } from "./services/cognito.js";

type Event={requestContext:{routeKey:string;connectionId:string;domainName:string;stage:string};queryStringParameters?:Record<string,string|undefined>;body?:string};
const response=(statusCode:number,body="")=>({statusCode,body});

/** Configure API Gateway WebSocket routes $connect/$disconnect/$default to this Lambda.
 * The $connect Lambda validates the Cognito access token before retaining the connection.
 */
export async function handler(event:Event){
  const {routeKey,connectionId,domainName,stage}=event.requestContext;
  if(!connectionId)return response(400,"Missing connection id");
  if(routeKey==="$connect"){
    const token=event.queryStringParameters?.token;
    if(!token)return response(401,"Missing access token");
    try{const claims=await verifyAccessToken(token);await docDb.send(new PutCommand({TableName:tables.notifications,Item:{id:`ws-${connectionId}`,user_id:claims.sub,connection_id:connectionId,type:"ws_connection",created_at:new Date().toISOString(),expires_at:Math.floor(Date.now()/1000)+3600}}));return response(200,"Connected");}catch{return response(401,"Invalid access token");}
  }
  if(routeKey==="$disconnect"){await docDb.send(new DeleteCommand({TableName:tables.notifications,Key:{id:`ws-${connectionId}`}})).catch(()=>undefined);return response(200,"Disconnected");}
  const endpoint=process.env.WEBSOCKET_MANAGEMENT_ENDPOINT??`https://${domainName}/${stage}`;
  const client=new ApiGatewayManagementApiClient({endpoint,region:process.env.AWS_REGION??"af-south-1"});
  try{const body=JSON.parse(event.body??"{}");if(body.action==="ping")await client.send(new PostToConnectionCommand({ConnectionId:connectionId,Data:Buffer.from(JSON.stringify({type:"pong",at:new Date().toISOString()}))}));return response(200,"OK");}catch{return response(400,"Invalid message");}
}
