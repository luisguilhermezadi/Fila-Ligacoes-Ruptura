```javascript
import { supabase } from "./supabase.js";
import { bindAuthUI, requireApprovedUser } from "./auth.js";

let currentUser = null;

const STORAGE_PREFIX = "callup_cons_v3_";

let contacts = [];
let idx = 0;

const $ = (id) => document.getElementById(id);

/* =========================================================
   CONFIGURAÇÃO
========================================================= */

const OPERATOR_CODES = ["021", "015", "041", "031"];

/*
  021 = Claro
  015 = Vivo
  041 = TIM
  031 = Oi
*/

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
   LIMPAR TELEFONE
========================================================= */

function cleanPhone(value) {
  let s = String(value ?? "").trim();

  if (!s) return "";

  /*
   * Corrige números vindos do Excel:
   *
   * 11987654321.0
   * 11987654321,0
   */
  if (/^\d+([.,]\d+)?$/.test(s)) {
    s = s.replace(/[.,]\d+$/, "");
  }

  /*
   * Remove tudo que não for número.
   */
  return s.replace(/\D/g, "");
}

/* =========================================================
   NORMALIZAR NÚMERO PARA ALTERAÇÃO DE OPERADORA
========================================================= */

/*
 * Esta função remove:
 *
 * - código do país 55
 * - código de operadora 021
 * - código de operadora 015
 * - código de operadora 041
 * - código de operadora 031
 * - zero de longa distância
 *
 * E retorna somente:
 *
 * DDD + número
 *
 * Exemplo:
 *
 * 02111987654321
 *       ↓
 * 11987654321
 */
function removeOperator(raw) {
  let n = cleanPhone(raw);

  if (!n) return "";

  /*
   * Remove código do país.
   */
  if (n.startsWith("55")) {
    n = n.slice(2);
  }

  /*
   * Remove operadora existente.
   */
  for (const code of OPERATOR_CODES) {
    if (n.startsWith(code)) {
      n = n.slice(3);
      break;
    }
  }

  /*
   * Remove zero inicial restante.
   */
  if (n.startsWith("0")) {
    n = n.slice(1);
  }

  return n;
}

/* =========================================================
   APLICAR OPERADORA
========================================================= */

/*
 * Esta função NÃO apenas calcula o número.
 *
 * Ela realmente altera o número.
 *
 * Exemplo:
 *
 * 02111987654321
 *
 * selecionado:
 *
 * 015
 *
 * resultado:
 *
 * 01511987654321
 */
function applyOperatorToNumber(raw, operator) {
  const base = removeOperator(raw);

  if (!base) return "";

  if (!operator) {
    return base;
  }

  return operator + base;
}

/* =========================================================
   NÚMERO PARA LIGAÇÃO
========================================================= */

function telNumber(raw) {
  /*
   * O número já deve estar atualizado
   * na lista.
   *
   * Portanto aqui somente limpamos
   * caracteres desnecessários.
   */

  const n = cleanPhone(raw);

  if (!n) return "";

  return n;
}

/* =========================================================
   FORMATAÇÃO VISUAL
========================================================= */

function formatPhone(raw) {
  let n = cleanPhone(raw);

  if (!n) return "";

  /*
   * Para exibição, remove 55.
   */
  if (n.startsWith("55")) {
    n = n.slice(2);
  }

  /*
   * Remove operadora somente
   * para deixar a visualização amigável.
   */
  for (const code of OPERATOR_CODES) {
    if (n.startsWith(code)) {
      n = n.slice(3);
      break;
    }
  }

  /*
   * Celular:
   * (11) 98765-4321
   */
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

  /*
   * Fixo:
   * (11) 8765-4321
   */
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
      localStorage.getItem(
        storageKey()
      );

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

  if (!element) return;

  element.textContent = message;

  element.classList.add("show");

  clearTimeout(window.__toast);

  window.__toast = setTimeout(() => {
    element.classList.remove("show");
  }, 2500);
}

/* =========================================================
   PROGRESSO
========================================================= */

function pct() {
  if (!contacts.length) {
    return 0;
  }

  return (
    (contacts.filter(
      (c) => c.status
    ).length /
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
   RENDER
========================================================= */

function render() {
  const hasContacts =
    contacts.length > 0;

  $("dashboard").classList.toggle(
    "hidden",
    !hasContacts
  );

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
      (x) => x.status
    ).length;

  const pending =
    contacts.length - done;

  const progress = pct();

  $("total").textContent =
    contacts.length.toLocaleString(
      "pt-BR"
    );

  $("done").textContent =
    done.toLocaleString(
      "pt-BR"
    );

  $("pending").textContent =
    pending.toLocaleString(
      "pt-BR"
    );

  $("percent").textContent =
    (
      progress < 10
        ? progress.toFixed(2)
        : progress.toFixed(0)
    ) + "%";

  $("counter").textContent =
    `${idx + 1} / ${contacts.length.toLocaleString("pt-BR")}`;

  $("name").textContent =
    contact.name ||
    "Sem nome";

  $("phone").textContent =
    formatPhone(
      contact.phone
    );

  $("avatar").textContent =
    initials(contact.name)
      .slice(0, 2)
      .toUpperCase();

  $("progressText").textContent =
    `${done.toLocaleString("pt-BR")} / ${contacts.length.toLocaleString("pt-BR")} contatos`;

  $("progressPct").textContent =
    `${progress.toFixed(2)}% concluído`;

  $("progressFill").style.width =
    Math.min(
      100,
      progress
    ) + "%";

  $("prev").disabled =
    idx === 0;

  $("next").disabled =
    idx ===
    contacts.length - 1;

  document
    .querySelectorAll(
      ".status-btn"
    )
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
  const output =
    $("queue");

  if (!output) {
    return;
  }

  output.innerHTML = "";

  $("queueCount").textContent =
    contacts.length.toLocaleString(
      "pt-BR"
    ) +
    " contatos";

  if (!contacts.length) {
    output.innerHTML =
      '<div class="empty">Fila concluída.</div>';

    return;
  }

  contacts.forEach(
    (contact, position) => {

      const element =
        document.createElement(
          "div"
        );

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

      element.querySelector(
        ".qname"
      ).textContent =
        contact.name ||
        "Sem nome";

      element.querySelector(
        ".qphone"
      ).textContent =
        formatPhone(
          contact.phone
        );

      const status =
        element.querySelector(
          ".qstatus"
        );

      status.textContent =
        statusLabel(
          contact.status
        );

      status.classList.add(
        contact.status ||
          "pending"
      );

      /*
       * Clique no contato
       * dentro da fila.
       */
      element.onclick = () => {
        idx = position;

        saveLocal();

        render();
      };

      output.appendChild(
        element
      );
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
   BOTÃO ALTERAR OPERADORA
========================================================= */

function createOperatorButton() {

  const operator =
    $("operator");

  if (!operator) {
    console.error(
      "Elemento #operator não encontrado."
    );

    return;
  }

  /*
   * Evita criar o botão duas vezes.
   */
  if (
    $("applyOperator")
  ) {
    return;
  }

  /*
   * Cria botão.
   */
  const button =
    document.createElement(
      "button"
    );

  button.id =
    "applyOperator";

  button.type =
    "button";

  button.className =
    "btn";

  button.style.width =
    "100%";

  button.style.minHeight =
    "54px";

  button.style.marginBottom =
    "10px";

  button.textContent =
    "🔄 ALTERAR NÚMEROS CONFORME OPERADORA";

  /*
   * Insere logo abaixo
   * do seletor.
   */
  operator.parentNode.insertBefore(
    button,
    operator.nextSibling
  );

  /*
   * Evento.
   */
  button.onclick =
    applySelectedOperator;
}

/* =========================================================
   APLICAR OPERADORA EM TODA A LISTA
========================================================= */

function applySelectedOperator() {

  /*
   * Não existe lista.
   */
  if (!contacts.length) {

    toast(
      "Importe uma lista primeiro."
    );

    return;
  }

  /*
   * Operadora selecionada.
   */
  const operator =
    $("operator")?.value || "";

  /*
   * Nome da operadora.
   */
  const operatorNames = {
    "021": "CLARO — 021",
    "015": "VIVO — 015",
    "041": "TIM — 041",
    "031": "OI — 031",
    "": "SEM OPERADORA"
  };

  const operatorName =
    operatorNames[operator] ||
    operator;

  /*
   * Confirmação.
   */
  const confirmed =
    confirm(
      `ALTERAR NÚMEROS?\n\n` +
      `Todos os ${contacts.length.toLocaleString("pt-BR")} ` +
      `números da lista serão ajustados para:\n\n` +
      `${operatorName}\n\n` +
      `Se um número já tiver 021, 015, 041 ou 031, ` +
      `o código atual será substituído.\n\n` +
      `Deseja continuar?`
    );

  if (!confirmed) {
    return;
  }

  let changed = 0;

  /*
   * Percorre TODOS os contatos.
   */
  contacts.forEach(
    (contact) => {

      const oldNumber =
        contact.phone;

      const newNumber =
        applyOperatorToNumber(
          oldNumber,
          operator
        );

      if (
        newNumber &&
        newNumber !== oldNumber
      ) {

        contact.phone =
          newNumber;

        changed++;
      }
    }
  );

  /*
   * Salva os números
   * permanentemente no localStorage
   * desta lista/usuário.
   */
  saveLocal();

  /*
   * Atualiza a interface.
   */
  render();

  /*
   * Mensagem.
   */
  if (operator) {

    toast(
      `${changed.toLocaleString("pt-BR")} números alterados para ${operatorName}`
    );

  } else {

    toast(
      `${changed.toLocaleString("pt-BR")} números ajustados`
    );
  }
}

/* =========================================================
   LIGAR
========================================================= */

function openCurrent() {

  const contact =
    contacts[idx];

  if (!contact) {
    return;
  }

  /*
   * Marca como chamado.
   */
  contact.called =
    true;

  saveLocal();

  render();

  /*
   * IMPORTANTE:
   *
   * Aqui NÃO adicionamos mais
   * uma operadora.
   *
   * O número já foi alterado
   * pelo botão:
   *
   * ALTERAR NÚMEROS CONFORME OPERADORA
   */
  const numberToCall =
    telNumber(
      contact.phone
    );

  if (!numberToCall) {

    toast(
      "Número de telefone inválido."
    );

    return;
  }

  console.log(
    "Número armazenado:",
    contact.phone
  );

  console.log(
    "Número discado:",
    numberToCall
  );

  /*
   * Abre o telefone do dispositivo.
   */
  window.location.href =
    "tel:" + numberToCall;
}

/* =========================================================
   STATUS NO SUPABASE
========================================================= */

async function saveStatusToServer(
  status
) {

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
   IMPORTAR PLANILHA
========================================================= */

$("file").addEventListener(
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

      /*
       * Primeira coluna = nome
       * Segunda coluna = número
       *
       * Também mantém detecção
       * automática pelo nome da coluna.
       */
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

      if (nameIndex < 0) {
        nameIndex = 0;
      }

      if (phoneIndex < 0) {

        phoneIndex =
          headers.length > 1
            ? 1
            : 0;
      }

      /*
       * Cria contatos.
       */
      const parsed =
        rows
          .slice(1)
          .map(
            (row) => ({
              name:
                String(
                  row[nameIndex] ??
                    ""
                ).trim(),

              phone:
                cleanPhone(
                  row[phoneIndex]
                ),

              status: "",

              called: false
            })
          )
          .filter(
            (contact) =>
              contact.phone.length >=
              10
          );

      if (!parsed.length) {

        throw new Error(
          "Nenhum telefone válido encontrado."
        );
      }

      /*
       * Substitui a lista.
       */
      contacts =
        parsed;

      idx = 0;

      saveLocal();

      render();

      toast(
        `${contacts.length.toLocaleString("pt-BR")} contatos importados`
      );

      setTimeout(
        () => {

          $("dashboard")
            .scrollIntoView({
              behavior: "smooth",
              block: "start"
            });

        },
        80
      );

    } catch (error) {

      console.error(
        "Erro ao importar planilha:",
        error
      );

      alert(
        "Não consegui ler a planilha. " +
        "Verifique se a coluna 1 contém o nome " +
        "e a coluna 2 contém o número."
      );
    }

    event.target.value =
      "";
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

$("next").onclick =
  () => {

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

$("prev").onclick =
  () => {

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
  .querySelectorAll(
    ".status-btn"
  )
  .forEach(
    (button) => {

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
    }
  );

/* =========================================================
   RECOMEÇAR
========================================================= */

$("reset").onclick =
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
  };

/* =========================================================
   NOVA LISTA
========================================================= */

$("newList").onclick =
  () => {

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
   INICIAR USUÁRIO
========================================================= */

async function start(
  current
) {

  currentUser =
    current.user;

  $("userBadge").textContent =
    current.profile.full_name ||
    current.user.email;

  $("authGate")
    .classList.add(
      "hidden"
    );

  $("app")
    .classList.remove(
      "hidden"
    );

  /*
   * Cria o botão de alterar
   * operadora.
   */
  createOperatorButton();

  /*
   * Carrega lista salva.
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
   VERIFICAR LOGIN EXISTENTE
========================================================= */

(async () => {

  try {

    const current =
      await requireApprovedUser();

    if (current) {

      await start(
        current
      );
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
