import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { destination, loadSession } from "../src/auth";
export default function Layout() {
  const [ready,setReady]=useState(false);const router=useRouter();const segments=useSegments();
  useEffect(()=>{let mounted=true;loadSession().finally(()=>{if(mounted)setReady(true);});return()=>{mounted=false;}},[]);
  useEffect(()=>{if(!ready)return;let cancelled=false;loadSession().then(async session=>{if(cancelled)return;const root=segments[0];const authRoute=root==="auth";const privateRoute=["learner","instructor","admin","complete-profile"].includes(root??"");if(!session&&privateRoute)router.replace("/auth/login");else if(session&&authRoute)router.replace(await destination(session));else if(session&&root==="complete-profile"&&session.user.role!=="learner")router.replace(await destination(session));else if(session?.user.role==="learner"&&!session.profileComplete&&(root==="learner"||root==="index"))router.replace("/complete-profile");else if(session?.user.role==="instructor"&&!session.profileComplete&&(root==="instructor"||root==="index")&&!segments.join("/").startsWith("instructor/onboarding"))router.replace("/instructor/onboarding");else if(session&&((root==="learner"&&session.user.role!=="learner")||(root==="instructor"&&session.user.role!=="instructor")||(root==="admin"&&session.user.role!=="admin")))router.replace(await destination(session));});return()=>{cancelled=true;}},[ready,segments.join("/")]);
  if(!ready)return <View style={{flex:1,alignItems:"center",justifyContent:"center",backgroundColor:"#f8f7f2"}}><ActivityIndicator color="#244b38"/></View>;
  return <><StatusBar style="dark"/><Stack screenOptions={{ headerShown:false, contentStyle:{backgroundColor:"#f8f7f2"} }} /></>;
}
