```javascript
import { supabase } from "./supabase.js";
import { bindAuthUI, requireApprovedUser } from "./auth.js";

let currentUser = null;

const STORAGE_PREFIX = "callup_cons_v3_";
let contacts = [];
let idx = 0;

const $ = (id) => document.getElementById(id);

/* =========================================================
   UTILITÁRIOS
========================================================= */

const normalize = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function findCol(headers, words) {
  return headers.findIndex((h) =>
    words.some((w) => normalize(h).includes(w))
  );
}

/* =========================================================
   LIMPEZA DE TELEFONE
========================================================= */

function cleanPhone(value) {
  let s = String(value ?? "").trim();

  if (!s) return "";

  // Corrige números que vieram do Excel como:
  // 11987654321.0
  // 11987654321,0
  if (/^\d+([.,]\d+)?$/.test(s)) {
    s = s.replace(/[.,]\d+$/, "");
  }

  // Mantém somente números
  return s.replace(/\D/g, "");
}

/* =========================================================
   CÓDIGOS DE OPERADORA
========================================================= */

/*
  Códigos aceitos:

  021 = Claro
  015 = Vivo
  041 = TIM
  031 = Oi
*/

const OPERATOR_CODES = ["021", "015", "041", "031"];

/* =========================================================
   TELEFONE PARA LIGAÇÃO
========================================================= */

function telNumber(raw) {
  let n = cleanPhone(raw);

  if (!n) return "";

  /*
   * 1. Remove o código do país 55.
   *
   * Exemplos:
   * 5511987654321
   * 5502111987654321
   */
  if (n.startsWith("55")) {
    n = n.slice(2);
  }

  /*
   * 2. Remove uma operadora que já exista.
   *
   * Exemplos:
   *
   * 02111987654321
   * 01511987654321
   * 04111987654321
   * 03111987654321
   *
   * Todos passam a ser:
   *
   * 11987654321
   */
  for (const code of OPERATOR_CODES) {
    if (n.startsWith(code)) {
      n = n.slice(3);
      break;
    }
  }

  /*
   * 3. Remove o zero inicial restante.
   *
   * Exemplo:
   *
   * 011987654321
   * vira
   * 11987654321
   */
  if (n.startsWith("0")) {
    n = n.slice(1);
  }

  /*
   * 4. Lê a operadora selecionada no menu.
   *
   * HTML:
   *
   * 021 = Claro
   * 015 = Vivo
   * 041 = TIM
   * 031 = Oi
   */
  const operator = $("operator")?.value || "";

  /*
   * 5. Adiciona a operadora escolhida.
   *
   * Portanto:
   *
   * número: 02111987654321
   * selecionado: 015
   *
   * resultado:
   * 01511987654321
   */
  if (operator) {
    return operator + n;
  }

  /*
   * Sem operadora:
   * mantém somente o número.
   */
  return n;
}

/* =========================================================
   FORMATAÇÃO VISUAL
========================================================= */

function formatPhone(raw) {
  let n = cleanPhone(raw);

  /*
   * Remove 55 apenas para exibição.
   */
  if (n.startsWith("55")) {
    n = n.slice(2);
  }

  /*
   * Remove operadora para exibição.
   */
  for (const code of OPERATOR_CODES) {
    if (n.startsWith(code)) {
      n = n.slice(3);
      break;
    }
  }

  if (n.length === 11) {
    return (
      "(" +
      n.slice(0, 2) +
      ") " +
      n.slice(2, 7) +
      "-" +
      n.slice(7)
    );
  }

  if (n.length === 10) {
    return (
      "(" +
      n.slice(0, 2) +
      ") " +
      n.slice(2, 6) +
      "-" +
      n.slice(6)
    );
  }

  return n;
}

/* =========================================================
   STORAGE
========================================================= */

function storageKey() {
  return STORAGE_PREFIX + (currentUser?.id || "anonymous");
}

function saveLocal() {
  try {
    localStorage.setItem(
      storageKey(),
      JSON.stringify({
        contacts,
        idx,
        savedAt: Date.now()
      })
    );
  } catch (err) {
    console.error("Erro ao salvar lista:", err);
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(storageKey());

    if (!raw) return false;

    const data = JSON.parse(raw);

    if (
      !Array.isArray(data.contacts) ||
      !data.contacts.length
    ) {
      return false;
    }

    contacts = data.contacts;

    idx = Math.max(
      0,
      Math.min(
        Number(data.idx) || 0,
        contacts.length - 1
      )
    );

    return true;

  } catch (err) {
    console.error("Erro ao carregar lista:", err);
    return false;
  }
}

/* =========================================================
   TOAST
========================================================= */

function toast(message) {
  const element = $("toast");

  if (!element) return;

  element.textContent = message;

  element.classList.add("show");

  clearTimeout(window.__toast);

  window.__toast = setTimeout(() => {
    element.classList.remove("show");
  }, 2300);
}

/* =========================================================
   PROGRESSO
========================================================= */

function pct() {
  if (!contacts.length) return 0;

  return (
    (contacts.filter((c) => c.status).length /
      contacts.length) *
    100
  );
}

/* =========================================================
   INICIAIS
========================================================= */

function initials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return (
    (parts[0]?.[0] || "?") +
    (parts.length > 1
      ? parts[parts.length - 1][0]
      : "")
  );
}

/* =========================================================
   RENDER PRINCIPAL
========================================================= */

function render() {
  const hasContacts = contacts.length > 0;

  $("dashboard").classList.toggle(
    "hidden",
    !hasContacts
  );

  if (!hasContacts) return;

  idx = Math.max(
    0,
    Math.min(idx, contacts.length - 1)
  );

  const contact = contacts[idx];

  const done = contacts.filter(
    (x) => x.status
  ).length;

  const pending =
    contacts.length - done;

  const progress = pct();

  $("total").textContent =
    contacts.length.toLocaleString("pt-BR");

  $("done").textContent =
    done.toLocaleString("pt-BR");

  $("pending").textContent =
    pending.toLocaleString("pt-BR");

  $("percent").textContent =
    (progress < 10
      ? progress.toFixed(2)
      : progress.toFixed(0)) + "%";

  $("counter").textContent =
    `${idx + 1} / ${contacts.length.toLocaleString("pt-BR")}`;

  $("name").textContent =
    contact.name || "Sem nome";

  $("phone").textContent =
    formatPhone(contact.phone);

  $("avatar").textContent =
    initials(contact.name)
      .slice(0, 2)
      .toUpperCase();

  $("progressText").textContent =
    `${done.toLocaleString("pt-BR")} / ${contacts.length.toLocaleString("pt-BR")} contatos`;

  $("progressPct").textContent =
    `${progress.toFixed(2)}% concluído`;

  $("progressFill").style.width =
    Math.min(100, progress) + "%";

  $("prev").disabled = idx === 0;

  $("next").disabled =
    idx === contacts.length - 1;

  document
    .querySelectorAll(".status-btn")
    .forEach((button) => {
      button.classList.toggle(
        "active",
        button.dataset.status ===
          contact.status
      );
    });

  renderQueue();
}

/* =========================================================
   STATUS
========================================================= */

function statusLabel(status) {
  return {
    atendeu: "✓ ATENDEU",
    nao_atendeu: "✕ NÃO ATENDEU",
    retornar: "↩ RETORNAR",
    sem_interesse: "🚫 SEM INTERESSE"
  }[status] || "PENDENTE";
}

/* =========================================================
   FILA
========================================================= */

function renderQueue() {
  const output = $("queue");

  if (!output) return;

  output.innerHTML = "";

  const list = contacts.map(
    (contact, position) => ({
      contact,
      position
    })
  );

  $("queueCount").textContent =
    contacts.length.toLocaleString("pt-BR") +
    " contatos";

  if (!list.length) {
    output.innerHTML =
      '<div class="empty">Fila concluída.</div>';

    return;
  }

  list.forEach(({ contact, position }) => {
    const element =
      document.createElement("div");

    element.className =
      "queue-item" +
      (position === idx
        ? " current"
        : "");

    element.innerHTML = `
      <div class="qnum">
        ${position + 1}
      </div>

      <div class="qinfo">
        <div class="qname"></div>
        <div class="qphone"></div>
        <div class="qstatus"></div>
      </div>
    `;

    element.querySelector(
      ".qname"
    ).textContent =
      contact.name || "Sem nome";

    element.querySelector(
      ".qphone"
    ).textContent =
      formatPhone(contact.phone);

    const status =
      element.querySelector(
        ".qstatus"
      );

    status.textContent =
      statusLabel(contact.status);

    status.classList.add(
      contact.status || "pending"
    );

    /*
     * Permite clicar em um contato
     * diretamente na fila.
     */
    element.onclick = () => {
      idx = position;
      saveLocal();
      render();
    };

    output.appendChild(element);
  });

  const current =
    output.querySelector(
      ".queue-item.current"
    );

  if (current) {
    current.scrollIntoView({
      block: "nearest",
      behavior: "smooth"
    });
  }
}

/* =========================================================
   ABRIR LIGAÇÃO
========================================================= */

function openCurrent() {
  const contact = contacts[idx];

  if (!contact) return;

  /*
   * Marca como chamado.
   */
  contact.called = true;

  saveLocal();

  render();

  /*
   * Monta o número usando:
   *
   * - 55
   * - código de operadora existente
   * - 0
   * - operadora selecionada
   */
  const numberToCall =
    telNumber(contact.phone);

  if (!numberToCall) {
    toast("Número de telefone inválido.");
    return;
  }

  console.log(
    "Número original:",
    contact.phone
  );

  console.log(
    "Número para ligação:",
    numberToCall
  );

  /*
   * Abre o aplicativo Telefone
   * do dispositivo.
   */
  window.location.href =
    "tel:" + numberToCall;
}

/* =========================================================
   SALVAR STATUS NO SUPABASE
========================================================= */

async function saveStatusToServer(status) {
  /*
   * Os contatos continuam somente
   * no dispositivo.
   *
   * O Supabase recebe somente
   * o evento agregado de status.
   */

  try {
    await supabase.rpc(
      "record_contact_status_event",
      {
        p_status: status
      }
    );

  } catch (error) {
    console.error(
      "Erro ao registrar status:",
      error
    );
  }
}

/* =========================================================
   IMPORTAÇÃO DA PLANILHA
========================================================= */

$("file").addEventListener(
  "change",
  async (event) => {

    const file =
      event.target.files[0];

    if (!file) return;

    try {

      const data =
        await file.arrayBuffer();

      const workbook =
        XLSX.read(data, {
          type: "array"
        });

      const worksheet =
        workbook.Sheets[
          workbook.SheetNames[0]
        ];

      const rows =
        XLSX.utils.sheet_to_json(
          worksheet,
          {
            header: 1,
            defval: ""
          }
        );

      if (!rows.length) {
        throw new Error(
          "Planilha vazia."
        );
      }

      const headers = rows[0];

      /*
       * A estrutura principal é:
       *
       * COLUNA 1 = NOME
       * COLUNA 2 = NÚMERO
       *
       * A detecção por nome permanece
       * como compatibilidade.
       */

      let nameIndex =
        findCol(headers, [
          "nome",
          "name",
          "cliente",
          "contato"
        ]);

      let phoneIndex =
        findCol(headers, [
          "numero",
          "telefone",
          "celular",
          "phone",
          "fone",
          "whatsapp"
        ]);

      if (nameIndex < 0) {
        nameIndex = 0;
      }

      if (phoneIndex < 0) {
        phoneIndex =
          headers.length > 1
            ? 1
            : 0;
      }

      const parsed =
        rows
          .slice(1)
          .map((row) => ({
            name: String(
              row[nameIndex] ?? ""
            ).trim(),

            phone: cleanPhone(
              row[phoneIndex]
            ),

            status: "",

            called: false
          }))
          .filter(
            (contact) =>
              contact.phone.length >= 10
          );

      if (!parsed.length) {
        throw new Error(
          "Nenhum telefone válido encontrado."
        );
      }

      contacts = parsed;

      idx = 0;

      saveLocal();

      render();

      toast(
        `${contacts.length.toLocaleString("pt-BR")} contatos importados`
      );

      setTimeout(() => {
        $("dashboard").scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }, 80);

    } catch (error) {

      console.error(
        "Erro ao importar:",
        error
      );

      alert(
        "Não consegui ler a planilha. " +
        "Verifique se a coluna 1 contém o nome " +
        "e a coluna 2 contém o número."
      );

    }

    event.target.value = "";
  }
);

/* =========================================================
   BOTÃO LIGAR
========================================================= */

$("call").onclick =
  openCurrent;

/* =========================================================
   PRÓXIMO
========================================================= */

$("next").onclick = () => {

  if (
    idx <
    contacts.length - 1
  ) {

    idx++;

    saveLocal();

    render();
  }
};

/* =========================================================
   ANTERIOR
========================================================= */

$("prev").onclick = () => {

  if (idx > 0) {

    idx--;

    saveLocal();

    render();
  }
};

/* =========================================================
   STATUS DA LIGAÇÃO
========================================================= */

document
  .querySelectorAll(".status-btn")
  .forEach((button) => {

    button.onclick =
      async () => {

        if (!contacts[idx]) {
          return;
        }

        contacts[idx].status =
          button.dataset.status;

        saveLocal();

        render();

        toast(
          "Status salvo neste dispositivo"
        );

        await saveStatusToServer(
          button.dataset.status
        );
      };
  });

/* =========================================================
   RECOMEÇAR
========================================================= */

$("reset").onclick = () => {

  if (!contacts.length) return;

  if (
    confirm(
      "Voltar para o primeiro contato e manter os status?"
    )
  ) {

    idx = 0;

    saveLocal();

    render();
  }
};

/* =========================================================
   NOVA LISTA
========================================================= */

$("newList").onclick = () => {

  if (
    !confirm(
      "Substituir a lista atual? " +
      "Os contatos e status atuais serão removidos deste dispositivo."
    )
  ) {
    return;
  }

  contacts = [];

  idx = 0;

  localStorage.removeItem(
    storageKey()
  );

  render();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
};

/* =========================================================
   INICIALIZAÇÃO DO USUÁRIO
========================================================= */

async function start(current) {

  currentUser =
    current.user;

  $("userBadge").textContent =
    current.profile.full_name ||
    current.user.email;

  $("authGate")
    .classList.add("hidden");

  $("app")
    .classList.remove("hidden");

  /*
   * Recupera a lista salva
   * para este usuário neste dispositivo.
   */
  if (loadLocal()) {
    render();
  }
}

/* =========================================================
   AUTENTICAÇÃO
========================================================= */

bindAuthUI(
  async (current) => {
    await start(current);
  }
);

/* =========================================================
   VERIFICAR USUÁRIO JÁ LOGADO
========================================================= */

(async () => {

  try {

    const current =
      await requireApprovedUser();

    if (current) {
      await start(current);
    }

  } catch (error) {

    console.error(
      "Erro ao verificar autenticação:",
      error
    );

    const message =
      document.getElementById(
        "authMessage"
      );

    if (message) {
      message.textContent =
        error.message ||
        "Não foi possível verificar o acesso.";
    }
  }

})();
```
