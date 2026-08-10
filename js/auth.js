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
