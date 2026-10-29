import * as SecureStore from "expo-secure-store";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const KEY = "mzansidrive.session";
export type Role = "learner"|"instructor"|"admin";
export type Session = {accessToken:string;idToken:string;refreshToken:string;expiresIn:number;user:{id:string;email?:string;role:Role};profileComplete?:boolean};

export async function loadSession():Promise<Session|null>{
  const raw=await SecureStore.getItemAsync(KEY);if(!raw)return null;
  try{const session=JSON.parse(raw) as Session;const me=await apiFetch("/v1/auth/me");if(me.status===401)return null;if(me.ok){const data=await me.json();session.profileComplete=data.profileComplete;await saveSession(session);}return session;}catch{return null;}
}
export async function saveSession(session:Session){await SecureStore.setItemAsync(KEY,JSON.stringify(session));}
export async function clearSession(){await SecureStore.deleteItemAsync(KEY);}
export async function authRequest(path:string,body:unknown){
  return fetch(API+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
}
export async function apiFetch(path:string,init:RequestInit={}):Promise<Response>{
  const raw=await SecureStore.getItemAsync(KEY);if(!raw)return new Response(JSON.stringify({error:"Authentication required"}),{status:401,headers:{"content-type":"application/json"}});
  const session=JSON.parse(raw) as Session;
  const send=(token:string)=>fetch(API+path,{...init,headers:{...(init.headers??{}),authorization:"Bearer "+token}});
  let response=await send(session.accessToken);
  if(response.status===401&&session.refreshToken){
    const refreshed=await authRequest("/v1/auth/refresh",{refreshToken:session.refreshToken});
    if(refreshed.ok){const data=await refreshed.json();const updated={...session,...data,refreshToken:data.refreshToken??session.refreshToken};await saveSession(updated);response=await send(updated.accessToken);}
    else await clearSession();
  }
  return response;
}
export async function signIn(email:string,password:string,admin=false):Promise<Session>{
  const response=await authRequest(admin?"/v1/auth/admin/login":"/v1/auth/login",{email,password});const data=await response.json();
  if(!response.ok)throw new Error(data.error??"Could not sign in.");
  const session=data as Session;const me=await apiFetchWithToken("/v1/auth/me",session.accessToken);if(me.ok)session.profileComplete=(await me.json()).profileComplete;
  await saveSession(session);return session;
}
async function apiFetchWithToken(path:string,token:string){return fetch(API+path,{headers:{authorization:"Bearer "+token}});}
export async function destination(session:Session){if(session.user.role==="learner")return session.profileComplete?"/learner":"/complete-profile";if(session.user.role==="instructor")return session.profileComplete?"/instructor":"/instructor/onboarding";return "/admin";}
export async function apiUrl(){return API;}
