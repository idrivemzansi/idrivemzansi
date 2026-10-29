"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, CarFront, CircleHelp, FileText, GraduationCap, LayoutDashboard, LogOut, MessageCircle, Settings, ShieldCheck, Users, Wallet, Video } from "lucide-react";

const links = {
  learner: [{ label:"Overview",href:"/learner",icon:LayoutDashboard },{ label:"Find an instructor",href:"/#explore",icon:CarFront },{ label:"Book a lesson",href:"/learner/book",icon:CarFront },{ label:"My lessons",href:"/learner?tab=bookings",icon:CalendarDays },{ label:"Messages",href:"/learner/messages",icon:MessageCircle },{ label:"Progress & logbook",href:"/learner?tab=progress",icon:GraduationCap },{ label:"K53 practice",href:"/learner?tab=k53",icon:FileText },{ label:"Account settings",href:"/learner/settings",icon:Settings }],
  instructor: [{ label:"Instructor Dashboard",href:"/instructor",icon:LayoutDashboard },{ label:"Messages",href:"/instructor/messages",icon:MessageCircle },{ label:"Manage Payouts",href:"/instructor?tab=payouts",icon:Wallet },{ label:"Profile settings",href:"/instructor/settings",icon:Settings }],
  admin: [{ label:"Overview",href:"/admin/dashboard",icon:LayoutDashboard },{ label:"Instructor verification",href:"/admin/dashboard?tab=instructors",icon:CarFront },{ label:"Bookings",href:"/admin/dashboard?tab=bookings",icon:CalendarDays },{ label:"Disputes",href:"/admin/dashboard?tab=disputes",icon:ShieldCheck },{ label:"Payments",href:"/admin/dashboard?tab=payments",icon:Wallet },{ label:"Payout batches",href:"/admin/dashboard?tab=batches",icon:Wallet },{ label:"Companies",href:"/admin/dashboard?tab=companies",icon:Users },{ label:"Analytics",href:"/admin/dashboard?tab=analytics",icon:Settings }],
};

export default function RoleShell({ role,email,children }: { role:"learner"|"instructor"|"admin";email?:string;children:React.ReactNode }) {
  const path=usePathname();const router=useRouter();const search=useSearchParams().toString();const current=path+(search?"?"+search:"");
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace(role==="admin"?"/admin":"/login");}
  return <main className="role-shell"><header className="role-header"><Link href="/" className="auth-brand"><span><CarFront size={18}/></span><b>mzansi<span>drive</span></b></Link><span>{role==="admin"?"ADMIN PORTAL":role==="instructor"?"INSTRUCTOR STUDIO":"LEARNER SPACE"}</span><div className="role-identity">{email&&<span>{email}</span>}<button onClick={logout}><LogOut size={13}/> Sign out</button></div></header><div className="role-body"><nav className="role-nav"><small>{role.toUpperCase()} MENU</small>{links[role].map(item=>{const Icon=item.icon;return <Link key={item.href} href={item.href} className={current===item.href?"active":""}><Icon/>{item.label}</Link>})}{role!=="instructor"&&<Link href="/help"><CircleHelp/>Help & support</Link>}</nav><section className="role-content">{children}</section></div></main>;
}
