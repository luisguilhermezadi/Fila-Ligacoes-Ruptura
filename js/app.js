import { supabase } from "./supabase.js";
import { bindAuthUI, requireApprovedUser } from "./auth.js";

let currentUser = null;

const STORAGE_PREFIX = "callup_cons_v5_";

let contacts = [];
let idx = 0;

const $ = (id) => document.getElementById(id);

/* =========================================================
   UTILITÁRIOS
========================================================= */

const normalize = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function findCol(headers, words) {
  return headers.findIndex((header) =>
    words.some((word) =>
      normalize(header).includes(word)
    )
  );
}

/* =========================================================
   LIMPEZA DO TELEFONE
========================================================= */

function cleanPhone(value) {
  let phone = String(value ?? "").trim();

  if (!phone) {
    return "";
  }

  if (/^\d+([.,]\d+)?$/.test(phone)) {
    phone = phone.replace(/[.,]\d+$/, "");
  }

  return phone.replace(/\D/g, "");
}

/* =========================================================
   TRANSFORMA QUALQUER FORMATO EM:

   DDD + NÚMERO

   Exemplos:

   02111999999999
   01511999999999
   04111999999999
   03111999999999

   5511999999999

   011999999999

   Tudo vira:

   11999999999
========================================================= */

function baseBrazilianNumber(raw) {
  let number = cleanPhone(raw);

  if (!number) {
    return "";
  }

  /* Remove código internacional 55 */
  if (number.startsWith("55")) {
    number = number.slice(2);
  }

  /*
   * Remove código de operadora.
   *
   * IMPORTANTE:
   * Isso acontece antes de aplicar
   * uma nova operadora.
   */
  const operatorCodes = ["021", "015", "041", "031"];

  for (const code of operatorCodes) {
    if (number.startsWith(code)) {
      number = number.slice(code.length);
      break;
    }
  }

  /* Remove zero nacional inicial */
  while (number.startsWith("0")) {
    number = number.slice(1);
  }

  return number;
}

/* =========================================================
   APLICA OPERADORA
========================================================= */

function applyOperator(raw, operator) {
  const base = baseBrazilianNumber(raw);

  if (!base) {
    return "";
  }

  /*
   * Sem operadora:
   *
   * 11999999999
   */
  if (!operator) {
    return base;
  }

  /*
   * Com operadora:
   *
   * Claro = 02111999999999
   * Vivo  = 01511999999999
   * TIM   = 04111999999999
   * Oi    = 03111999999999
   */
  return `${operator}${base}`;
}

/* =========================================================
   DETECTA OPERADORA DO NÚMERO
========================================================= */

function detectOperator(raw) {
  const number = cleanPhone(raw);

  if (number.startsWith("021")) {
    return "021";
  }

  if (number.startsWith("015")) {
    return "015";
  }

  if (number.startsWith("041")) {
    return "041";
  }

  if (number.startsWith("031")) {
    return "031";
  }

  return "";
}

/* =========================================================
   NÚMERO PARA LIGAÇÃO
========================================================= */

function telNumber(raw) {
  const number = cleanPhone(raw);

  if (!number) {
    return "";
  }

  /*
   * Se já tiver código de operadora,
   * usa exatamente o número salvo.
   */
  if (
    number.startsWith("021") ||
    number.startsWith("015") ||
    number.startsWith("041") ||
    number.startsWith("031")
  ) {
    return number;
  }

  /*
   * Número internacional.
   */
  if (number.startsWith("55")) {
    return `+${number}`;
  }

  /*
   * Número nacional sem operadora.
   */
  return number;
}

/* =========================================================
   FORMATAÇÃO VISUAL
========================================================= */

function formatPhone(raw) {
  let number = cleanPhone(raw);

  if (!number) {
    return "—";
  }

  let operator = "";

  const detected = detectOperator(number);

  if (detected) {
    operator = detected;
    number = number.slice(3);
  }

  if (number.startsWith("55")) {
    number = number.slice(2);
  }

  let formatted = number;

  if (number.length === 11) {
    formatted =
      `(${number.slice(0, 2)}) ` +
      `${number.slice(2, 7)}-` +
      `${number.slice(7)}`;
  } else if (number.length === 10) {
    formatted =
      `(${number.slice(0, 2)}) ` +
      `${number.slice(2, 6)}-` +
      `${number.slice(6)}`;
  }

  if (operator) {
    return `${operator} ${formatted}`;
  }

  return formatted;
}

/* =========================================================
   INICIAIS
========================================================= */

function initials(name) {
  const parts = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return "?";
  }

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
  } catch (error) {
    console.error(
      "Erro ao salvar lista:",
      error
    );
  }
}

function loadLocal() {
  try {
    const raw =
      localStorage.getItem(storageKey());

    if (!raw) {
      return false;
    }

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
  } catch (error) {
    console.error(
      "Erro ao carregar lista:",
      error
    );

    return false;
  }
}

/* =========================================================
   TOAST
========================================================= */

function toast(message) {
  const element = $("toast");

  if (!element) {
    return;
  }

  element.textContent = String(message);

  element.classList.add("show");

  clearTimeout(window.__callupToast);

  window.__callupToast =
    setTimeout(() => {
      element.classList.remove("show");
    }, 3000);
}

/* =========================================================
   PROGRESSO
========================================================= */

function getProgress() {
  if (!contacts.length) {
    return 0;
  }

  const completed =
    contacts.filter(
      (contact) => Boolean(contact.status)
    ).length;

  return (completed / contacts.length) * 100;
}

/* =========================================================
   OPERADORA
========================================================= */

function currentOperator() {
  const select = $("operator");

  if (!select) {
    return "";
  }

  return select.value || "";
}

function operatorName(code) {
  const names = {
    "021": "CLARO",
    "015": "VIVO",
    "041": "TIM",
    "031": "OI"
  };

  return names[code] || "SEM OPERADORA";
}

/* =========================================================
   ALTERAR NÚMEROS CONFORME OPERADORA

   ESTA É A PARTE PRINCIPAL DA CORREÇÃO.

   Exemplo:

   Antes:
   02111999999999

   Escolher VIVO:

   Depois:
   01511999999999

   Não fica:

   0150211199999999

========================================================= */

function updateNumbersForOperator() {
  if (!contacts.length) {
    toast(
      "Importe uma lista antes de alterar os números."
    );

    return;
  }

  const select = $("operator");

  if (!select) {
    toast(
      "Seletor de operadora não encontrado."
    );

    return;
  }

  const operator = select.value || "";

  let changed = 0;
  let invalid = 0;

  contacts = contacts.map((contact) => {
    const original =
      String(contact.phone || "");

    const base =
      baseBrazilianNumber(original);

    if (!base || base.length < 10) {
      invalid++;

      return {
        ...contact
      };
    }

    const newPhone =
      applyOperator(
        base,
        operator
      );

    if (
      newPhone &&
      newPhone !== original
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

  if (!operator) {
    toast(
      `Operadora removida de ${changed} número(s).`
    );

    return;
  }

  toast(
    `Números alterados: ${changed}`
  );

  console.log(
    "ALTERAÇÃO DE OPERADORA",
    {
      operadora: operator,
      nome: operatorName(operator),
      alterados: changed,
      invalidos: invalid,
      total: contacts.length
    }
  );
}

/* =========================================================
   RENDER
========================================================= */

function render() {
  const hasContacts =
    contacts.length > 0;

  const dashboard =
    $("dashboard");

  if (dashboard) {
    dashboard.classList.toggle(
      "hidden",
      !hasContacts
    );
  }

  if (!hasContacts) {
    return;
  }

  idx = Math.max(
    0,
    Math.min(
      idx,
      contacts.length - 1
    )
  );

  const contact =
    contacts[idx];

  const done =
    contacts.filter(
      (item) => Boolean(item.status)
    ).length;

  const pending =
    contacts.length - done;

  const progress =
    getProgress();

  if ($("total")) {
    $("total").textContent =
      contacts.length.toLocaleString("pt-BR");
  }

  if ($("done")) {
    $("done").textContent =
      done.toLocaleString("pt-BR");
  }

  if ($("pending")) {
    $("pending").textContent =
      pending.toLocaleString("pt-BR");
  }

  if ($("percent")) {
    $("percent").textContent =
      `${progress.toFixed(0)}%`;
  }

  if ($("counter")) {
    $("counter").textContent =
      `${idx + 1} / ${contacts.length.toLocaleString("pt-BR")}`;
  }

  if ($("name")) {
    $("name").textContent =
      contact.name || "Sem nome";
  }

  if ($("phone")) {
    $("phone").textContent =
      formatPhone(contact.phone);
  }

  if ($("avatar")) {
    $("avatar").textContent =
      initials(contact.name)
        .slice(0, 2)
        .toUpperCase();
  }

  const selectedOperator =
    currentOperator();

  const operatorInfo =
    $("operatorInfo");

  if (operatorInfo) {
    operatorInfo.textContent =
      selectedOperator
        ? `${operatorName(selectedOperator)} — ${selectedOperator}`
        : "Sem código de operadora";
  }

  if ($("progressText")) {
    $("progressText").textContent =
      `${done.toLocaleString("pt-BR")} / ${contacts.length.toLocaleString("pt-BR")} contatos`;
  }

  if ($("progressPct")) {
    $("progressPct").textContent =
      `${progress.toFixed(0)}% concluído`;
  }

  if ($("progressFill")) {
    $("progressFill").style.width =
      `${Math.min(100, progress)}%`;
  }

  if ($("prev")) {
    $("prev").disabled =
      idx === 0;
  }

  if ($("next")) {
    $("next").disabled =
      idx === contacts.length - 1;
  }

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
  const labels = {
    atendeu: "✓ ATENDEU",
    nao_atendeu: "✕ NÃO ATENDEU",
    retornar: "↩ RETORNAR",
    sem_interesse: "🚫 SEM INTERESSE"
  };

  return labels[status] || "PENDENTE";
}

/* =========================================================
   FILA
========================================================= */

function renderQueue() {
  const output =
    $("queue");

  if (!output) {
    return;
  }

  output.innerHTML = "";

  if ($("queueCount")) {
    $("queueCount").textContent =
      `${contacts.length.toLocaleString("pt-BR")} contatos`;
  }

  if (!contacts.length) {
    output.innerHTML =
      '<div class="empty">Nenhum contato na fila.</div>';

    return;
  }

  contacts.forEach(
    (contact, position) => {
      const element =
        document.createElement("div");

      element.className =
        "queue-item" +
        (
          position === idx
            ? " current"
            : ""
        );

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

      const nameElement =
        element.querySelector(".qname");

      const phoneElement =
        element.querySelector(".qphone");

      const statusElement =
        element.querySelector(".qstatus");

      nameElement.textContent =
        contact.name || "Sem nome";

      phoneElement.textContent =
        formatPhone(contact.phone);

      statusElement.textContent =
        statusLabel(contact.status);

      statusElement.classList.add(
        contact.status || "pending"
      );

      element.addEventListener(
        "click",
        () => {
          idx = position;

          saveLocal();
          render();
        }
      );

      output.appendChild(element);
    }
  );

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
  const contact =
    contacts[idx];

  if (!contact) {
    return;
  }

  const number =
    telNumber(contact.phone);

  if (!number) {
    toast(
      "Este contato não possui um número válido."
    );

    return;
  }

  contact.called = true;

  saveLocal();
  render();

  window.location.href =
    `tel:${number}`;
}

/* =========================================================
   SUPABASE
========================================================= */

async function saveStatusToServer(status) {
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
   IMPORTAÇÃO
========================================================= */

const fileInput =
  $("file");

if (fileInput) {
  fileInput.addEventListener(
    "change",
    async (event) => {
      const file =
        event.target.files[0];

      if (!file) {
        return;
      }

      try {
        const data =
          await file.arrayBuffer();

        const workbook =
          XLSX.read(
            data,
            {
              type: "array"
            }
          );

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

        const headers =
          rows[0];

        let nameIndex =
          findCol(
            headers,
            [
              "nome",
              "name",
              "cliente",
              "contato"
            ]
          );

        let phoneIndex =
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

        /*
         * Se não detectar cabeçalho,
         * utiliza obrigatoriamente:
         *
         * coluna 1 = nome
         * coluna 2 = número
         */
        if (nameIndex < 0) {
          nameIndex = 0;
        }

        if (phoneIndex < 0) {
          phoneIndex =
            headers.length > 1
              ? 1
              : 0;
        }

        const selectedOperator =
          currentOperator();

        const parsed =
          rows
            .slice(1)
            .map((row) => {
              const name =
                String(
                  row[nameIndex] ?? ""
                ).trim();

              const originalPhone =
                cleanPhone(
                  row[phoneIndex]
                );

              const base =
                baseBrazilianNumber(
                  originalPhone
                );

              if (
                !base ||
                base.length < 10
              ) {
                return null;
              }

              const finalPhone =
                applyOperator(
                  base,
                  selectedOperator
                );

              return {
                name:
                  name || "Sem nome",

                phone:
                  finalPhone,

                status: "",

                called: false
              };
            })
            .filter(Boolean);

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

        setTimeout(() => {
          const dashboard =
            $("dashboard");

          if (dashboard) {
            dashboard.scrollIntoView({
              behavior: "smooth",
              block: "start"
            });
          }
        }, 100);

      } catch (error) {
        console.error(
          "Erro ao importar planilha:",
          error
        );

        alert(
          "Não consegui ler a planilha. Verifique se a coluna 1 contém o nome e a coluna 2 contém o número."
        );
      }

      event.target.value = "";
    }
  );
}

/* =========================================================
   ALTERAR OPERADORA
========================================================= */

const changeOperatorBtn =
  $("changeOperatorBtn");

if (changeOperatorBtn) {
  changeOperatorBtn.addEventListener(
    "click",
    () => {
      updateNumbersForOperator();
    }
  );
}

/* =========================================================
   LIGAR
========================================================= */

const callButton =
  $("call");

if (callButton) {
  callButton.addEventListener(
    "click",
    openCurrent
  );
}

/* =========================================================
   PRÓXIMO
========================================================= */

const nextButton =
  $("next");

if (nextButton) {
  nextButton.addEventListener(
    "click",
    () => {
      if (
        idx <
        contacts.length - 1
      ) {
        idx++;

        saveLocal();
        render();
      }
    }
  );
}

/* =========================================================
   ANTERIOR
========================================================= */

const prevButton =
  $("prev");

if (prevButton) {
  prevButton.addEventListener(
    "click",
    () => {
      if (idx > 0) {
        idx--;

        saveLocal();
        render();
      }
    }
  );
}

/* =========================================================
   STATUS
========================================================= */

document
  .querySelectorAll(".status-btn")
  .forEach((button) => {
    button.addEventListener(
      "click",
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
      }
    );
  });

/* =========================================================
   RECOMEÇAR
========================================================= */

const resetButton =
  $("reset");

if (resetButton) {
  resetButton.addEventListener(
    "click",
    () => {
      if (!contacts.length) {
        return;
      }

      if (
        confirm(
          "Voltar para o primeiro contato e manter os status?"
        )
      ) {
        idx = 0;

        saveLocal();
        render();
      }
    }
  );
}

/* =========================================================
   NOVA LISTA
========================================================= */

const newListButton =
  $("newList");

if (newListButton) {
  newListButton.addEventListener(
    "click",
    () => {
      if (
        !confirm(
          "Substituir a lista atual? Os contatos e status atuais serão removidos deste dispositivo."
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
    }
  );
}

/* =========================================================
   SAIR

   Ao clicar em SAIR:
   1. Faz logout
   2. Aguarda
   3. Recarrega a página inteira
   4. Usuário volta para tela de login
========================================================= */

const logoutButton =
  $("logoutBtn");

if (logoutButton) {
  logoutButton.addEventListener(
    "click",
    async () => {
      logoutButton.disabled = true;

      try {
        const { error } =
          await supabase.auth.signOut();

        if (error) {
          throw error;
        }
      } catch (error) {
        console.error(
          "Erro ao sair:",
          error
        );
      } finally {
        window.location.reload();
      }
    }
  );
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

async function start(current) {
  currentUser =
    current.user;

  if ($("userBadge")) {
    $("userBadge").textContent =
      current.profile?.full_name ||
      current.user.email;
  }

  $("authGate")
    ?.classList
    .add("hidden");

  $("app")
    ?.classList
    .remove("hidden");

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
   VERIFICAR USUÁRIO APROVADO
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
      "Erro ao verificar usuário:",
      error
    );

    const message =
      $("authMessage");

    if (message) {
      message.textContent =
        error.message ||
        "Não foi possível verificar sua conta.";
    }
  }
})();
