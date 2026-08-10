import { supabase } from "./supabase.js";
import { ADMIN_EMAIL } from "./config.js";

const $ = (id) => document.getElementById(id);

let heartbeatInterval = null;


/* =========================================================
   PERFIL
========================================================= */

export async function getProfile() {

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return null;

  const {
    data,
    error
  } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (error) throw error;

  return {
    user,
    profile: data
  };
}


/* =========================================================
   USUÁRIO APROVADO
========================================================= */

export async function requireApprovedUser() {

  const current = await getProfile();

  if (!current) return null;

  if (current.profile.status !== "approved") {

    await logout();

    const labels = {

      pending:
        "Sua conta ainda aguarda aprovação do administrador.",

      rejected:
        "Sua solicitação de acesso foi recusada.",

      blocked:
        "Sua conta está bloqueada."

    };

    throw new Error(
      labels[current.profile.status] ||
      "Sua conta não possui acesso."
    );
  }

  return current;
}


/* =========================================================
   LOGIN
========================================================= */

export async function login(email, password) {

  /*
   * Primeiro autentica no Supabase.
   */

  const {
    data,
    error
  } = await supabase.auth.signInWithPassword({

    email,
    password

  });


  if (error) {
    throw error;
  }


  /*
   * Depois solicita o dispositivo único.
   */

  const {
    data: sessionCheck,
    error: checkError
  } = await supabase.rpc(
    "claim_login_session"
  );


  if (checkError) {

    await supabase.auth.signOut();

    throw new Error(
      "Erro ao verificar dispositivo: " +
      checkError.message
    );
  }


  /*
   * Outro dispositivo já está utilizando a conta.
   */

  if (!sessionCheck?.allowed) {

    await supabase.auth.signOut();


    if (
      sessionCheck?.reason ===
      "active_session"
    ) {

      throw new Error(
        "Esta conta já está sendo utilizada em outro dispositivo."
      );
    }


    if (
      sessionCheck?.reason ===
      "pending"
    ) {

      throw new Error(
        "Sua conta ainda aguarda aprovação do administrador."
      );
    }


    if (
      sessionCheck?.reason ===
      "rejected"
    ) {

      throw new Error(
        "Sua solicitação de acesso foi recusada."
      );
    }


    if (
      sessionCheck?.reason ===
      "blocked"
    ) {

      throw new Error(
        "Sua conta está bloqueada."
      );
    }


    throw new Error(
      "Não foi possível liberar o acesso."
    );
  }


  /*
   * Começa o heartbeat.
   */

  startHeartbeat();


  return data;
}


/* =========================================================
   HEARTBEAT
========================================================= */

function startHeartbeat() {

  stopHeartbeat();


  /*
   * Atualiza a sessão a cada 5 minutos.
   */

  heartbeatInterval =
    setInterval(
      async () => {

        try {

          const {
            data: { user }
          } = await supabase.auth.getUser();


          if (!user) {

            stopHeartbeat();

            return;
          }


          /*
           * Administrador não possui
           * login_sessions.
           */

          const {
            data: profile
          } = await supabase
            .from("profiles")
            .select("is_admin")
            .eq("id", user.id)
            .single();


          if (profile?.is_admin) {

            return;
          }


          /*
           * Renova a sessão do dispositivo.
           */

          const {
            data,
            error
          } = await supabase.rpc(
            "keep_login_session"
          );


          if (error) {

            console.error(
              "Erro ao renovar sessão:",
              error
            );

            return;
          }


          /*
           * Se não existe mais sessão,
           * encerra o login.
           */

          if (data === false) {

            console.warn(
              "Sessão do dispositivo não encontrada."
            );

            stopHeartbeat();

            await supabase.auth.signOut();

            return;
          }


        } catch (err) {

          console.error(
            "Erro no heartbeat:",
            err
          );

        }

      },

      5 * 60 * 1000
    );
}


/* =========================================================
   PARAR HEARTBEAT
========================================================= */

function stopHeartbeat() {

  if (heartbeatInterval) {

    clearInterval(
      heartbeatInterval
    );

    heartbeatInterval = null;
  }
}


/* =========================================================
   CADASTRO
========================================================= */

export async function signup(
  name,
  email,
  password
) {

  const {
    data,
    error
  } = await supabase.auth.signUp({

    email,
    password

  });


  if (error) {
    throw error;
  }


  if (!data.user) {

    throw new Error(
      "Não foi possível criar a conta."
    );
  }


  /*
   * O trigger do banco cria o profile.
   */

  const {
    error: profileError
  } = await supabase
    .from("profiles")
    .upsert({

      id: data.user.id,

      full_name: name,

      email:
        email.toLowerCase(),

      status: "pending"

    });


  if (profileError) {

    throw profileError;
  }
}


/* =========================================================
   LOGOUT
========================================================= */

export async function logout() {

  stopHeartbeat();


  /*
   * Libera o dispositivo.
   */

  try {

    await supabase.rpc(
      "release_login_session"
    );

  } catch (err) {

    console.error(
      "Erro ao liberar dispositivo:",
      err
    );

  }


  /*
   * Encerra a sessão do Supabase.
   */

  await supabase.auth.signOut();
}


/* =========================================================
   INTERFACE DE AUTENTICAÇÃO
========================================================= */

export function bindAuthUI(onApproved) {

  $("showSignup").onclick = () => {

    $("loginForm")
      .classList.add("hidden");

    $("showSignup")
      .classList.add("hidden");

    $("signupForm")
      .classList.remove("hidden");

    $("showLogin")
      .classList.remove("hidden");

    $("authMessage").textContent =
      "Solicite seu acesso. O administrador precisa aprovar a conta.";
  };


  $("showLogin").onclick = () => {

    $("signupForm")
      .classList.add("hidden");

    $("showLogin")
      .classList.add("hidden");

    $("loginForm")
      .classList.remove("hidden");

    $("showSignup")
      .classList.remove("hidden");

    $("authMessage").textContent =
      "Sua conta precisa estar aprovada para acessar a central.";
  };


  $("loginForm").onsubmit =
    async (e) => {

      e.preventDefault();


      try {

        await login(

          $("loginEmail")
            .value
            .trim(),

          $("loginPassword")
            .value

        );


        const current =
          await requireApprovedUser();


        await onApproved(
          current
        );


      } catch (err) {

        $("authMessage").textContent =
          err.message ||
          "Não foi possível entrar.";

      }

    };


  $("signupForm").onsubmit =
    async (e) => {

      e.preventDefault();


      const p1 =
        $("signupPassword").value;

      const p2 =
        $("signupPassword2").value;


      if (p1 !== p2) {

        $("authMessage").textContent =
          "As senhas não coincidem.";

        return;
      }


      try {

        await signup(

          $("signupName")
            .value
            .trim(),

          $("signupEmail")
            .value
            .trim(),

          p1

        );


        $("authMessage").textContent =
          "Cadastro enviado. Aguarde a aprovação do administrador.";


        $("signupForm").reset();


        $("signupForm")
          .classList.add("hidden");

        $("showLogin")
          .classList.add("hidden");

        $("loginForm")
          .classList.remove("hidden");

        $("showSignup")
          .classList.remove("hidden");


      } catch (err) {

        $("authMessage").textContent =
          err.message ||
          "Não foi possível criar a conta.";

      }

    };


  $("logoutBtn").onclick =
    logout;
}


export { ADMIN_EMAIL };
