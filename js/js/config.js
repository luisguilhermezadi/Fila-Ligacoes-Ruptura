// Preencha com as informações do seu projeto Supabase.
// NUNCA coloque a service_role key neste arquivo. Somente a chave anon/publishable.
export const SUPABASE_URL = "COLE_AQUI_A_URL_DO_SUPABASE";
export const SUPABASE_ANON_KEY = "COLE_AQUI_A_CHAVE_ANON_PUBLIC";
export const ADMIN_EMAIL = "beawarumbyof@gmail.com";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

import { supabase } from "./supabase.js";
import { bindAuthUI, requireApprovedUser } from "./auth.js";

let currentUser = null;

const STORAGE_PREFIX = "callup_cons_v3_";
let contacts = [], idx = 0;

const $ = id => document.getElementById(id);
const normalize = s => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]/g,"");
function findCol(headers, words){ return headers.findIndex(h => words.some(w => normalize(h).includes(w))); }
function cleanPhone(v){
  let s=String(v??"").trim();
  if(!s)return "";
  if(/^\d+([.,]\d+)?$/.test(s))s=s.replace(/[.,]\d+$/,"");
  return s.replace(/\D/g,"");
}
function telNumber(raw){ let n=cleanPhone(raw); if(n.startsWith("55"))return "+"+n; if(n.startsWith("0"))return n; return "0"+n; }
function formatPhone(raw){
  let n=cleanPhone(raw); if(n.startsWith("55"))n=n.slice(2);
  if(n.length===11)return "("+n.slice(0,2)+") "+n.slice(2,7)+"-"+n.slice(7);
  if(n.length===10)return "("+n.slice(0,2)+") "+n.slice(2,6)+"-"+n.slice(6);
  return n;
}
function storageKey(){ return STORAGE_PREFIX + (currentUser?.id || "anonymous"); }
function saveLocal(){ try{ localStorage.setItem(storageKey(),JSON.stringify({contacts,idx,savedAt:Date.now()})); }catch{} }
function loadLocal(){
  try{ const raw=localStorage.getItem(storageKey()); if(!raw)return false; const d=JSON.parse(raw);
    if(!Array.isArray(d.contacts)||!d.contacts.length)return false; contacts=d.contacts;idx=Math.max(0,Math.min(Number(d.idx)||0,contacts.length-1));return true;
  }catch{return false}
}
function toast(msg){ $("toast").textContent=msg;$("toast").classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>$("toast").classList.remove("show"),2300); }
function pct(){ if(!contacts.length)return 0; return contacts.filter(c=>c.status).length/contacts.length*100; }
function initials(name){ const parts=String(name||"?").trim().split(/\s+/).filter(Boolean); return (parts[0]?.[0]||"?")+(parts.length>1?parts[parts.length-1][0]:""); }

function render(){
  const has=contacts.length>0; $("dashboard").classList.toggle("hidden",!has); if(!has)return;
  idx=Math.max(0,Math.min(idx,contacts.length-1)); const c=contacts[idx];
  const done=contacts.filter(x=>x.status).length,pending=contacts.length-done,p=pct();
  $("total").textContent=contacts.length.toLocaleString("pt-BR"); $("done").textContent=done.toLocaleString("pt-BR");
  $("pending").textContent=pending.toLocaleString("pt-BR"); $("percent").textContent=(p<10?p.toFixed(2):p.toFixed(0))+"%";
  $("counter").textContent=`${idx+1} / ${contacts.length.toLocaleString("pt-BR")}`;
  $("name").textContent=c.name||"Sem nome"; $("phone").textContent=formatPhone(c.phone);
  $("avatar").textContent=initials(c.name).slice(0,2).toUpperCase();
  $("progressText").textContent=`${done.toLocaleString("pt-BR")} / ${contacts.length.toLocaleString("pt-BR")} contatos`;
  $("progressPct").textContent=`${p.toFixed(2)}% concluído`; $("progressFill").style.width=Math.min(100,p)+"%";
  $("prev").disabled=idx===0; $("next").disabled=idx===contacts.length-1;
  document.querySelectorAll(".status-btn").forEach(b=>b.classList.toggle("active",b.dataset.status===c.status)); renderQueue();
}
function statusLabel(status){return {atendeu:"✓ ATENDEU",nao_atendeu:"✕ NÃO ATENDEU",retornar:"↩ RETORNAR",sem_interesse:"🚫 SEM INTERESSE"}[status]||"PENDENTE";}
function renderQueue(){
  const out=$("queue");out.innerHTML="";const list=contacts.map((c,pos)=>({c,pos}));
  $("queueCount").textContent=contacts.length.toLocaleString("pt-BR")+" contatos";
  if(!list.length){out.innerHTML='<div class="empty">Fila concluída.</div>';return}
  list.forEach(({c,pos})=>{
    const el=document.createElement("div");el.className="queue-item"+(pos===idx?" current":"");
    el.innerHTML=`<div class="qnum">${pos+1}</div><div class="qinfo"><div class="qname"></div><div class="qphone"></div><div class="qstatus"></div></div>`;
    el.querySelector(".qname").textContent=c.name||"Sem nome";el.querySelector(".qphone").textContent=formatPhone(c.phone);
    const s=el.querySelector(".qstatus");s.textContent=statusLabel(c.status);s.classList.add(c.status||"pending");out.appendChild(el);
  });
  const cur=out.querySelector(".queue-item.current");if(cur)cur.scrollIntoView({block:"nearest",behavior:"smooth"});
}
function openCurrent(){const c=contacts[idx];if(!c)return;c.called=true;saveLocal();render();window.location.href="tel:"+telNumber(c.phone);}
async function saveStatusToServer(status){
  // Contacts themselves remain local. This RPC only records aggregate activity for the authenticated user.
  try { await supabase.rpc("record_contact_status_event",{p_status:status}); } catch {}
}

$("file").addEventListener("change",async e=>{
  const file=e.target.files[0];if(!file)return;
  try{
    const data=await file.arrayBuffer(),wb=XLSX.read(data,{type:"array"}),ws=wb.Sheets[wb.SheetNames[0]];
    const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});if(!rows.length)throw new Error("Planilha vazia.");
    const headers=rows[0];
    // Requirement: column 1 = name, column 2 = number. Fallback detection is retained for compatibility.
    let ni=findCol(headers,["nome","name","cliente","contato"]);let pi=findCol(headers,["numero","telefone","celular","phone","fone","whatsapp"]);
    if(ni<0)ni=0;if(pi<0)pi=headers.length>1?1:0;
    const parsed=rows.slice(1).map(r=>({name:String(r[ni]??"").trim(),phone:cleanPhone(r[pi]),status:"",called:false})).filter(x=>x.phone.length>=10);
    if(!parsed.length)throw new Error("Nenhum telefone válido encontrado.");
    contacts=parsed;idx=0;saveLocal();render();toast(`${contacts.length.toLocaleString("pt-BR")} contatos importados`);
    setTimeout(()=>$("dashboard").scrollIntoView({behavior:"smooth",block:"start"}),80);
  }catch(err){alert("Não consegui ler a planilha. Verifique se a coluna 1 contém o nome e a coluna 2 contém o número.");}
  e.target.value="";
});
$("call").onclick=openCurrent;
$("next").onclick=()=>{if(idx<contacts.length-1){idx++;saveLocal();render()}};
$("prev").onclick=()=>{if(idx>0){idx--;saveLocal();render()}};
document.querySelectorAll(".status-btn").forEach(btn=>btn.onclick=async()=>{
  if(!contacts[idx])return; contacts[idx].status=btn.dataset.status;saveLocal();render();toast("Status salvo neste dispositivo"); await saveStatusToServer(btn.dataset.status);
});
$("reset").onclick=()=>{if(!contacts.length)return;if(confirm("Voltar para o primeiro contato e manter os status?")){idx=0;saveLocal();render()}};
$("newList").onclick=()=>{if(!confirm("Substituir a lista atual? Os contatos e status atuais serão removidos deste dispositivo."))return;contacts=[];idx=0;localStorage.removeItem(storageKey());render();window.scrollTo({top:0,behavior:"smooth"});};

async function start(current){
  currentUser=current.user;
  $("userBadge").textContent=current.profile.full_name || current.user.email;
  $("authGate").classList.add("hidden");$("app").classList.remove("hidden");
  if(loadLocal())render();
}

bindAuthUI(async current => start(current));

(async()=>{
  try{
    const current=await requireApprovedUser();
    if(current) await start(current);
  }catch(err){
    document.getElementById("authMessage").textContent=err.message;
  }
})();

import { supabase } from "./supabase.js";
import { ADMIN_EMAIL } from "./config.js";

const $ = (id) => document.getElementById(id);

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error) throw error;
  return { user, profile: data };
}

export async function requireApprovedUser() {
  const current = await getProfile();
  if (!current) return null;

  if (current.profile.status !== "approved") {
    await supabase.auth.signOut();
    const labels = {
      pending: "Sua conta ainda aguarda aprovação do administrador.",
      rejected: "Sua solicitação de acesso foi recusada.",
      blocked: "Sua conta está bloqueada."
    };
    throw new Error(labels[current.profile.status] || "Sua conta não possui acesso.");
  }
  return current;
}

export async function login(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  // A política de sessão única é reforçada pela função/RPC no banco.
  const { data: sessionCheck, error: checkError } = await supabase.rpc("claim_login_session");
  if (checkError) {
    await supabase.auth.signOut();
    throw checkError;
  }
  if (!sessionCheck?.allowed) {
    await supabase.auth.signOut();
    throw new Error("Esta conta já está sendo utilizada em outro dispositivo.");
  }
  return data;
}

export async function signup(name, email, password) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error("Não foi possível criar a conta.");
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: data.user.id,
    full_name: name,
    email: email.toLowerCase(),
    status: "pending"
  });
  if (profileError) throw profileError;
}

export async function logout() {
  try { await supabase.rpc("release_login_session"); } catch {}
  await supabase.auth.signOut();
}

export function bindAuthUI(onApproved) {
  $("showSignup").onclick = () => {
    $("loginForm").classList.add("hidden");
    $("showSignup").classList.add("hidden");
    $("signupForm").classList.remove("hidden");
    $("showLogin").classList.remove("hidden");
    $("authMessage").textContent = "Solicite seu acesso. O administrador precisa aprovar a conta.";
  };
  $("showLogin").onclick = () => {
    $("signupForm").classList.add("hidden");
    $("showLogin").classList.add("hidden");
    $("loginForm").classList.remove("hidden");
    $("showSignup").classList.remove("hidden");
    $("authMessage").textContent = "Sua conta precisa estar aprovada para acessar a central.";
  };

  $("loginForm").onsubmit = async (e) => {
    e.preventDefault();
    try {
      await login($("loginEmail").value.trim(), $("loginPassword").value);
      const current = await requireApprovedUser();
      await onApproved(current);
    } catch (err) {
      $("authMessage").textContent = err.message || "Não foi possível entrar.";
    }
  };

  $("signupForm").onsubmit = async (e) => {
    e.preventDefault();
    const p1 = $("signupPassword").value;
    const p2 = $("signupPassword2").value;
    if (p1 !== p2) { $("authMessage").textContent = "As senhas não coincidem."; return; }
    try {
      await signup($("signupName").value.trim(), $("signupEmail").value.trim(), p1);
      $("authMessage").textContent = "Cadastro enviado. Aguarde a aprovação do administrador.";
      $("signupForm").reset();
      $("signupForm").classList.add("hidden");
      $("showLogin").classList.add("hidden");
      $("loginForm").classList.remove("hidden");
      $("showSignup").classList.remove("hidden");
    } catch (err) {
      $("authMessage").textContent = err.message || "Não foi possível criar a conta.";
    }
  };

  $("logoutBtn").onclick = logout;
}

export { ADMIN_EMAIL };
