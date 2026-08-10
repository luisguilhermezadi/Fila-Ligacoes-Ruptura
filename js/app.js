import { supabase } from "./supabase.js";
import { bindAuthUI, requireApprovedUser } from "./auth.js";

let currentUser = null;

const STORAGE_PREFIX = "callup_cons_v3_";

let contacts = [];
let idx = 0;

const $ = id => document.getElementById(id);

/* =========================================================
   UTILITÁRIOS
========================================================= */

const normalize = s =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function findCol(headers, words) {
  return headers.findIndex(h =>
    words.some(w => normalize(h).includes(w))
  );
}

/* =========================================================
   LIMPEZA DE TELEFONE
========================================================= */

function cleanPhone(value) {

  let s = String(value ?? "").trim();

  if (!s) return "";

  /*
   * Remove casas decimais que podem aparecer
   * quando o Excel interpreta o telefone como número.
   *
   * Exemplo:
   * 11987654321.0
   * vira:
   * 11987654321
   */

  if (/^\d+([.,]\d+)?$/.test(s)) {
    s = s.replace(/[.,]\d+$/, "");
  }

  return s.replace(/\D/g, "");
}

/* =========================================================
   NORMALIZAÇÃO PARA TELEFONE BRASILEIRO
========================================================= */

function normalizeBrazilPhone(raw) {

  let n = cleanPhone(raw);

  if (!n) return "";

  /*
   * Remove o código internacional 55 temporariamente.
   */

  if (n.startsWith("55")) {
    n = n.slice(2);
  }

  /*
   * Remove zeros/códigos de operadora antigos.
   *
   * Exemplos:
   *
   * 02111987654321
   * 01511987654321
   * 04111987654321
   * 03111987654321
   *
   * tornam-se:
   *
   * 11987654321
   */

  if (n.length === 13 && n.startsWith("0")) {
    n = n.slice(3);
  }

  /*
   * Caso venha com 12 dígitos:
   *
   * 0211198765432
   *
   * também tenta remover o código.
   */

  if (n.length === 12 && n.startsWith("0")) {
    n = n.slice(3);
  }

  /*
   * Se ainda houver um zero inicial,
   * remove para deixar somente DDD + número.
   */

  if (n.startsWith("0")) {
    n = n.slice(1);
  }

  return n;
}

/* =========================================================
   APLICA OPERADORA
========================================================= */

function applyOperator(raw, operator) {

  let n = cleanPhone(raw);

  if (!n) return "";

  /*
   * Se não houver operadora selecionada,
   * retorna somente o número limpo.
   */

  if (!operator) {
    return n;
  }

  /*
   * Remove 55.
   */

  if (n.startsWith("55")) {
    n = n.slice(2);
  }

  /*
   * Remove qualquer código de operadora
   * que já esteja presente.
   *
   * Isso é o ponto importante:
   *
   * 02111987654321
   * vira
   * 11987654321
   *
   * 01511987654321
   * vira
   * 11987654321
   *
   * 04111987654321
   * vira
   * 11987654321
   */

  if (
    n.length >= 13 &&
    n.startsWith("0") &&
    ["021", "015", "041", "031"].includes(n.slice(0, 3))
  ) {
    n = n.slice(3);
  }

  /*
   * Caso tenha apenas 0 + código:
   */

  if (
    n.length >= 12 &&
    n.startsWith("0") &&
    ["021", "015", "041", "031"].includes(n.slice(0, 3))
  ) {
    n = n.slice(3);
  }

  /*
   * Remove zero adicional antes do DDD.
   */

  if (n.startsWith("0")) {
    n = n.slice(1);
  }

  /*
   * Agora n deve estar no formato:
   *
   * DDD + número
   *
   * Exemplo:
   * 11987654321
   *
   * Aplicamos a operadora:
   *
   * 015 + 11987654321
   *
   * = 01511987654321
   */

  return operator + n;
}

/* =========================================================
   NÚMERO PARA TEL:
   
   O formato utilizado pelo link tel:
   
   +55 + código operadora + DDD + número
========================================================= */

function telNumber(raw) {

  const n = cleanPhone(raw);

  if (!n) return "";

  if (n.startsWith("55")) {
    return "+" + n;
  }

  return "+55" + n;
}

/* =========================================================
   FORMATAÇÃO VISUAL
========================================================= */

function formatPhone(raw) {

  let n = cleanPhone(raw);

  if (n.startsWith("55")) {
    n = n.slice(2);
  }

  /*
   * Remove código de operadora para exibição
   * quando houver.
   */

  if (
    n.length === 14 &&
    n.startsWith("0") &&
    ["021", "015", "041", "031"].includes(n.slice(0, 3))
  ) {
    n = n.slice(3);
  }

  if (
    n.length === 13 &&
    n.startsWith("0") &&
    ["021", "015", "041", "031"].includes(n.slice(0, 3))
  ) {
    n = n.slice(3);
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

  return (
    STORAGE_PREFIX +
    (currentUser?.id || "anonymous")
  );

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

  } catch {}

}

function loadLocal() {

  try {

    const raw =
      localStorage.getItem(storageKey());

    if (!raw) return false;

    const d = JSON.parse(raw);

    if (
      !Array.isArray(d.contacts) ||
      !d.contacts.length
    ) {
      return false;
    }

    contacts = d.contacts;

    idx = Math.max(
      0,
      Math.min(
        Number(d.idx) || 0,
        contacts.length - 1
      )
    );

    return true;

  } catch {

    return false;

  }

}

/* =========================================================
   TOAST
========================================================= */

function toast(message) {

  const el = $("toast");

  if (!el) return;

  el.textContent = message;

  el.classList.add("show");

  clearTimeout(window.__toast);

  window.__toast =
    setTimeout(
      () =>
        el.classList.remove("show"),
      2300
    );

}

/* =========================================================
   PROGRESSO
========================================================= */

function pct() {

  if (!contacts.length) return 0;

  return (
    contacts.filter(
      c => c.status
    ).length /
    contacts.length
  ) * 100;

}

function initials(name) {

  const parts =
    String(name || "?")
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  return (
    (parts[0]?.[0] || "?") +
    (
      parts.length > 1
        ? parts[parts.length - 1][0]
        : ""
    )
  );

}

/* =========================================================
   RENDER
========================================================= */

function render() {

  const has =
    contacts.length > 0;

  $("dashboard")
    .classList
    .toggle("hidden", !has);

  if (!has) return;

  idx = Math.max(
    0,
    Math.min(
      idx,
      contacts.length - 1
    )
  );

  const c = contacts[idx];

  const done =
    contacts.filter(
      x => x.status
    ).length;

  const pending =
    contacts.length - done;

  const p = pct();

  $("total").textContent =
    contacts.length.toLocaleString("pt-BR");

  $("done").textContent =
    done.toLocaleString("pt-BR");

  $("pending").textContent =
    pending.toLocaleString("pt-BR");

  $("percent").textContent =
    (p < 10
      ? p.toFixed(2)
      : p.toFixed(0)
    ) + "%";

  $("counter").textContent =
    `${idx + 1} / ${contacts.length.toLocaleString("pt-BR")}`;

  $("name").textContent =
    c.name || "Sem nome";

  $("phone").textContent =
    formatPhone(c.phone);

  $("avatar").textContent =
    initials(c.name)
      .slice(0, 2)
      .toUpperCase();

  $("progressText").textContent =
    `${done.toLocaleString("pt-BR")} / ${contacts.length.toLocaleString("pt-BR")} contatos`;

  $("progressPct").textContent =
    `${p.toFixed(2)}% concluído`;

  $("progressFill").style.width =
    Math.min(100, p) + "%";

  $("prev").disabled =
    idx === 0;

  $("next").disabled =
    idx === contacts.length - 1;

  document
    .querySelectorAll(".status-btn")
    .forEach(button => {

      button.classList.toggle(
        "active",
        button.dataset.status ===
          c.status
      );

    });

  renderQueue();

}

/* =========================================================
   STATUS
========================================================= */

function statusLabel(status) {

  return {

    atendeu:
      "✓ ATENDEU",

    nao_atendeu:
      "✕ NÃO ATENDEU",

    retornar:
      "↩ RETORNAR",

    sem_interesse:
      "🚫 SEM INTERESSE"

  }[status] || "PENDENTE";

}

/* =========================================================
   FILA
========================================================= */

function renderQueue() {

  const out =
    $("queue");

  out.innerHTML = "";

  const list =
    contacts.map(
      (c, pos) => ({
        c,
        pos
      })
    );

  $("queueCount").textContent =
    contacts.length.toLocaleString("pt-BR") +
    " contatos";

  if (!list.length) {

    out.innerHTML =
      "Fila concluída.";

    return;

  }

  list.forEach(
    ({ c, pos }) => {

      const el =
        document.createElement(
          "div"
        );

      el.className =
        "queue-item" +
        (
          pos === idx
            ? " current"
            : ""
        );

      el.innerHTML = `
        <div class="qnum">
          ${pos + 1}
        </div>

        <div class="qinfo">

          <div class="qname"></div>

          <div class="qphone"></div>

          <div class="qstatus"></div>

        </div>
      `;

      el.querySelector(
        ".qname"
      ).textContent =
        c.name ||
        "Sem nome";

      el.querySelector(
        ".qphone"
      ).textContent =
        formatPhone(c.phone);

      const s =
        el.querySelector(
          ".qstatus"
        );

      s.textContent =
        statusLabel(c.status);

      s.classList.add(
        c.status || "pending"
      );

      out.appendChild(el);

    }
  );

  const cur =
    out.querySelector(
      ".queue-item.current"
    );

  if (cur) {

    cur.scrollIntoView({
      block: "nearest",
      behavior: "smooth"
    });

  }

}

/* =========================================================
   LIGAR CONTATO ATUAL
========================================================= */

function openCurrent() {

  const c =
    contacts[idx];

  if (!c) return;

  c.called = true;

  saveLocal();

  render();

  const number =
    telNumber(c.phone);

  if (!number) {

    toast(
      "Número de telefone inválido."
    );

    return;

  }

  /*
   * Abre o discador do aparelho.
   */

  window.location.href =
    "tel:" + number;

}

/* =========================================================
   SALVAR STATUS NO SUPABASE
========================================================= */

async function saveStatusToServer(status) {

  try {

    await supabase.rpc(
      "record_contact_status_event",
      {
        p_status: status
      }
    );

  } catch {}

}

/* =========================================================
   ALTERAR OPERADORA DE TODA A LISTA
========================================================= */

function changeOperatorForAll() {

  if (!contacts.length) {

    toast(
      "Importe uma lista primeiro."
    );

    return;

  }

  const operator =
    $("operator")?.value || "";

  if (!operator) {

    const confirmed =
      confirm(
        "A opção 'SEM OPERADORA' foi selecionada.\n\n" +
        "Isso removerá o código de operadora dos números.\n\n" +
        "Deseja continuar?"
      );

    if (!confirmed) return;

  }

  const names = {

    "021":
      "CLARO — 021",

    "015":
      "VIVO — 015",

    "041":
      "TIM — 041",

    "031":
      "OI — 031",

    "":
      "SEM OPERADORA"

  };

  const operatorName =
    names[operator] ||
    operator;

  const confirmed =
    confirm(
      `Alterar a operadora de TODOS os ${contacts.length} contatos para:\n\n` +
      `${operatorName}\n\n` +
      `Os números existentes serão atualizados.\n\n` +
      `Deseja continuar?`
    );

  if (!confirmed) return;

  let changed = 0;

  contacts =
    contacts.map(contact => {

      const oldPhone =
        contact.phone;

      const newPhone =
        applyOperator(
          oldPhone,
          operator
        );

      if (
        newPhone &&
        newPhone !== oldPhone
      ) {

        changed++;

      }

      return {
        ...contact,
        phone: newPhone
      };

    });

  saveLocal();

  render();

  const info =
    $("operatorInfo");

  if (info) {

    info.textContent =
      `${changed} número(s) atualizado(s) para ${operatorName}.`;

  }

  toast(
    `${changed} número(s) atualizado(s)`
  );

}

/* =========================================================
   IMPORTAÇÃO DA PLANILHA
========================================================= */

$("file")
  .addEventListener(
    "change",
    async e => {

      const file =
        e.target.files[0];

      if (!file) return;

      try {

        const data =
          await file.arrayBuffer();

        const wb =
          XLSX.read(
            data,
            {
              type: "array"
            }
          );

        const ws =
          wb.Sheets[
            wb.SheetNames[0]
          ];

        const rows =
          XLSX.utils.sheet_to_json(
            ws,
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

        const headers =
          rows[0];

        /*
         * Coluna 1 = nome
         * Coluna 2 = número
         */

        let ni =
          findCol(
            headers,
            [
              "nome",
              "name",
              "cliente",
              "contato"
            ]
          );

        let pi =
          findCol(
            headers,
            [
              "numero",
              "telefone",
              "celular",
              "phone",
              "fone",
              "whatsapp"
            ]
          );

        if (ni < 0) ni = 0;

        if (pi < 0) {

          pi =
            headers.length > 1
              ? 1
              : 0;

        }

        const parsed =
          rows
            .slice(1)
            .map(row => ({

              name:
                String(
                  row[ni] ?? ""
                ).trim(),

              phone:
                cleanPhone(
                  row[pi]
                ),

              status: "",

              called: false

            }))
            .filter(
              x =>
                x.phone.length >= 10
            );

        if (!parsed.length) {

          throw new Error(
            "Nenhum telefone válido encontrado."
          );

        }

        contacts =
          parsed;

        idx = 0;

        saveLocal();

        render();

        toast(
          `${contacts.length.toLocaleString("pt-BR")} contatos importados`
        );

        setTimeout(
          () =>
            $("dashboard")
              .scrollIntoView({
                behavior: "smooth",
                block: "start"
              }),
          80
        );

      } catch (err) {

        console.error(
          "Erro ao importar:",
          err
        );

        alert(
          "Não consegui ler a planilha.\n\n" +
          "Verifique se:\n" +
          "• a coluna 1 contém o nome;\n" +
          "• a coluna 2 contém o número."
        );

      }

      e.target.value = "";

    }
  );

/* =========================================================
   BOTÃO ALTERAR OPERADORA
========================================================= */

const changeOperatorButton =
  $("changeOperator");

if (changeOperatorButton) {

  changeOperatorButton.onclick =
    changeOperatorForAll;

}

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
   STATUS
========================================================= */

document
  .querySelectorAll(".status-btn")
  .forEach(button => {

    button.onclick =
      async () => {

        if (!contacts[idx])
          return;

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

  if (!contacts.length)
    return;

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
      "Substituir a lista atual?\n\n" +
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
   INICIALIZAÇÃO
========================================================= */

async function start(current) {

  currentUser =
    current.user;

  $("userBadge").textContent =
    current.profile.full_name ||
    current.user.email;

  $("authGate")
    .classList
    .add("hidden");

  $("app")
    .classList
    .remove("hidden");

  if (loadLocal()) {

    render();

  }

}

/* =========================================================
   AUTENTICAÇÃO
========================================================= */

bindAuthUI(
  async current =>
    start(current)
);

(async () => {

  try {

    const current =
      await requireApprovedUser();

    if (current) {

      await start(current);

    }

  } catch (err) {

    document.getElementById(
      "authMessage"
    ).textContent =
      err.message;

  }

})();
