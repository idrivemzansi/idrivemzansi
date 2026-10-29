"use client";
import { FormEvent,useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight,Check,FileUp,LoaderCircle,ShieldCheck } from "lucide-react";
import { isValidSaPhone,SA_PHONE_MESSAGE,toSaPhone } from "@/lib/sa-phone";

async function upload(file:File,category:"id-document"|"learners-license") {
  if(file.size>12*1024*1024)throw new Error("Each document must be 12 MB or smaller.");
  const signed=await fetch("/api/backend/v1/uploads/presign",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({category,fileName:file.name,contentType:file.type})});
  const data=await signed.json();if(!signed.ok)throw new Error(data.error??"Could not prepare document upload.");
  const result=await fetch(data.uploadUrl,{method:"PUT",headers:{"content-type":file.type,"x-amz-server-side-encryption":"AES256"},body:file});
  if(!result.ok)throw new Error("Document upload failed. Please try again.");
  return data.objectKey as string;
}
export default function LearnerProfileForm(){
  const router=useRouter();const [busy,setBusy]=useState(false);const [error,setError]=useState("");const [success,setSuccess]=useState(false);
  const [idDoc,setIdDoc]=useState<File|null>(null);const [licenseDoc,setLicenseDoc]=useState<File|null>(null);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();setBusy(true);setError("");setSuccess(false);
    const form=new FormData(event.currentTarget);
    try{
      if(!idDoc||!licenseDoc)throw new Error("Upload both your South African ID and learner’s licence.");
      const emergencyPhone=String(form.get("emergency_phone"));
      if(!isValidSaPhone(emergencyPhone))throw new Error(SA_PHONE_MESSAGE);
      const [idKey,licenseKey]=await Promise.all([upload(idDoc,"id-document"),upload(licenseDoc,"learners-license")]);
      const payload={full_name:String(form.get("full_name")),dob:String(form.get("dob")),address:String(form.get("address")),license_goal:String(form.get("license_goal")),transmission_preference:String(form.get("transmission_preference")),learning_style:String(form.get("learning_style")),emergency_contact:{name:String(form.get("emergency_name")),phone:toSaPhone(emergencyPhone),relationship:String(form.get("emergency_relationship"))},id_document_url:idKey,learners_license_url:licenseKey};
      const response=await fetch("/api/backend/v1/learners/me/profile",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
      const data=await response.json();if(!response.ok)throw new Error(data.error??"Could not save your profile.");
      setSuccess(true);setTimeout(()=>router.replace("/learner"),500);
    }catch(e){setError(e instanceof Error?e.message:"Something went wrong. Try again.");}
    finally{setBusy(false);}
  }
  return <form className="profile-form" onSubmit={submit}><h2>Your learner profile</h2><p>All fields and both documents are required to unlock your learner dashboard.</p>{success&&<div className="profile-success">Your profile is complete. Taking you to your learner space…</div>}<div className="profile-fields">
    <label>Full legal name<input name="full_name" autoComplete="name" required minLength={2}/></label>
    <label>Date of birth<input name="dob" type="date" required max={new Date().toISOString().slice(0,10)}/></label>
    <label className="wide">Home address<textarea name="address" autoComplete="street-address" required minLength={5} placeholder="Street address, suburb, city, postal code"/></label>
    <label>Licence goal<select name="license_goal" required defaultValue=""><option value="" disabled>Choose a licence goal</option><option value="Code B">Code B · Light motor vehicle</option><option value="Code C1">Code C1 · Light delivery vehicle</option><option value="Other">Other</option></select></label>
    <label>Transmission preference<select name="transmission_preference" required defaultValue=""><option value="" disabled>Choose one</option><option value="manual">Manual</option><option value="automatic">Automatic</option><option value="either">Either</option></select></label>
    <label className="wide">How do you learn best?<textarea name="learning_style" required minLength={2} placeholder="For example: hands-on practice, clear demonstrations, a calm pace…"/></label>
    <label>Emergency contact name<input name="emergency_name" required minLength={2}/></label>
    <label>Emergency contact phone<input name="emergency_phone" type="tel" required minLength={7} placeholder="+27821234567 or 0821234567"/></label>
    <label>Relationship to you<input name="emergency_relationship" required placeholder="Parent, partner, friend…"/></label>
    <label className="wide">South African ID document<div className="upload-field"><FileUp size={16}/><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={e=>setIdDoc(e.target.files?.[0]??null)}/><small>{idDoc? idDoc.name:"PDF or image · max 12 MB"}</small></div></label>
    <label className="wide">Learner’s licence<div className="upload-field"><FileUp size={16}/><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required onChange={e=>setLicenseDoc(e.target.files?.[0]??null)}/><small>{licenseDoc?licenseDoc.name:"PDF or image · max 12 MB"}</small></div></label>
  </div>{error&&<div className="form-error" role="alert">{error}</div>}<div className="auth-legal"><ShieldCheck size={14}/> Your ID and licence are uploaded to private encrypted storage.</div><div className="profile-actions"><button disabled={busy}>{busy?<><LoaderCircle className="spin" size={16}/> Saving securely…</>:<>Complete profile <ArrowRight size={15}/></>}</button></div></form>;
}
