import { supabase } from "./supabase.js";
import { bindAuthUI, requireApprovedUser } from "./auth.js";

let currentUser = null;

const STORAGE_PREFIX = "callup_cons_v4_";

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
   CONVERSÃO PARA BASE BRASILEIRA
=========================================================

   O objetivo desta função é retirar:

   +55
   55
   021
   015
   041
   031
   0 inicial

   deixando apenas:

   DDD + número

   Exemplo:

   02111999999999
   -> 11999999999

   01511999999999
   -> 11999999999

   5511999999999
   -> 11999999999

========================================================= */

function baseBrazilianNumber(raw) {

  let number = cleanPhone(raw);

  if (!number) {
    return "";
  }


  /* Remove código do país */

  if (number.startsWith("55")) {
    number = number.slice(2);
  }


  /*
   * Remove código de operadora existente.
   *
   * 021 + DDD + número
   * 015 + DDD + número
   * 041 + DDD + número
   * 031 + DDD + número
   */

  if (
    number.startsWith("021") ||
    number.startsWith("015") ||
    number.startsWith("041") ||
    number.startsWith("031")
  ) {
    number = number.slice(3);
  }


  /*
   * Se ainda houver um zero inicial,
   * remove esse zero.
   */

  if (number.startsWith("0")) {
    number = number.slice(1);
  }


  return number;
}


/* =========================================================
   APLICAÇÃO DA OPERADORA
========================================================= */

function applyOperator(raw, operator) {

  const base = baseBrazilianNumber(raw);

  if (!base) {
    return "";
  }

  /*
   * Sem operadora:
   * mantém DDD + número.
   */

  if (!operator) {
    return base;
  }

  /*
   * Operadora:
   *
   * 021 + DDD + número
   * 015 + DDD + número
   * 041 + DDD + número
   * 031 + DDD + número
   */

  return operator + base;
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
   * Se já estiver em formato:
   *
   * 0XX + DDD + número
   *
   * mantém exatamente assim.
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
   * Se estiver com 55:
   * transforma para +55...
   */

  if (number.startsWith("55")) {
    return "+" + number;
  }

  /*
   * Caso seja DDD + número sem operadora,
   * liga diretamente.
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


  /*
   * Número com código de operadora:
   *
   * 021 + 11 + 999999999
   */

  let operator = "";

  if (
    number.startsWith("021") ||
    number.startsWith("015") ||
    number.startsWith("041") ||
    number.startsWith("031")
  ) {
    operator = number.slice(0, 3);
    number = number.slice(3);
  }


  /*
   * Remove 55 para exibição.
   */

  if (number.startsWith("55")) {
    number = number.slice(2);
  }


  let formatted = number;

  if (number.length === 11) {
    formatted =
      "(" +
      number.slice(0, 2) +
      ") " +
      number.slice(2, 7) +
      "-" +
      number.slice(7);
  }

  else if (number.length === 10) {
    formatted =
      "(" +
      number.slice(0, 2) +
      ") " +
      number.slice(2, 6) +
      "-" +
      number.slice(6);
  }


  if (operator) {
    return operator + " " + formatted;
  }

  return formatted;
}


/* =========================================================
   NOME / INICIAIS
========================================================= */

function initials(name) {

  const parts =
    String(name || "?")
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

    const data =
      JSON.parse(raw);

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

  element.textContent = message;

  element.classList.add("show");

  clearTimeout(
    window.__toast
  );

  window.__toast =
    setTimeout(() => {

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
    contacts.filter(
      (contact) => contact.status
    ).length /
    contacts.length
  ) * 100;
}


/* =========================================================
   OPERADORA ATUAL
========================================================= */

function currentOperator() {

  const select = $("operator");

  if (!select) {
    return "";
  }

  return select.value;
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
   ALTERAR NÚMEROS DA LISTA
========================================================= */

function updateNumbersForOperator() {

  if (!contacts.length) {

    toast(
      "Importe uma lista antes de alterar os números."
    );

    return;
  }


  const operator =
    currentOperator();


  /*
   * Cria uma nova lista de contatos
   * aplicando a operadora escolhida.
   */

  contacts = contacts.map((contact) => {

    return {
      ...contact,
      phone: applyOperator(
        contact.phone,
        operator
      )
    };

  });


  saveLocal();

  render();


  if (operator) {

    toast(
      `Números atualizados para ${operatorName(operator)} — ${operator}`
    );

  } else {

    toast(
      "Operadora removida dos números."
    );

  }
}


/* =========================================================
   RENDERIZAÇÃO
========================================================= */

function render() {

  const hasContacts =
    contacts.length > 0;

  $("dashboard")
    .classList
    .toggle(
      "hidden",
      !hasContacts
    );

  if (!hasContacts) {
    return;
  }


  idx =
    Math.max(
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
      (item) => item.status
    ).length;


  const pending =
    contacts.length - done;


  const progress =
    pct();


  $("total").textContent =
    contacts.length.toLocaleString("pt-BR");

  $("done").textContent =
    done.toLocaleString("pt-BR");

  $("pending").textContent =
    pending.toLocaleString("pt-BR");


  $("percent").textContent =
    (
      progress < 10
        ? progress.toFixed(2)
        : progress.toFixed(0)
    ) + "%";


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


  const selectedOperator =
    currentOperator();


  if (selectedOperator) {

    $("operatorInfo").textContent =
      `${operatorName(selectedOperator)} — ${selectedOperator}`;

  } else {

    $("operatorInfo").textContent =
      "Sem código de operadora";

  }


  $("progressText").textContent =
    `${done.toLocaleString("pt-BR")} / ${contacts.length.toLocaleString("pt-BR")} contatos`;


  $("progressPct").textContent =
    `${progress.toFixed(2)}% concluído`;


  $("progressFill").style.width =
    Math.min(100, progress) + "%";


  $("prev").disabled =
    idx === 0;


  $("next").disabled =
    idx === contacts.length - 1;


  document
    .querySelectorAll(".status-btn")
    .forEach((button) => {

      button.classList.toggle(
        "active",
        button.dataset.status === contact.status
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

  output.innerHTML = "";


  $("queueCount").textContent =
    contacts.length.toLocaleString("pt-BR") +
    " contatos";


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


      element
        .querySelector(".qname")
        .textContent =
          contact.name || "Sem nome";


      element
        .querySelector(".qphone")
        .textContent =
          formatPhone(contact.phone);


      const statusElement =
        element.querySelector(".qstatus");


      statusElement.textContent =
        statusLabel(contact.status);


      statusElement.classList.add(
        contact.status || "pending"
      );


      /*
       * Permite clicar em qualquer contato
       * da fila para torná-lo atual.
       */

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


  /*
   * IMPORTANTE:
   * aqui é usado o número que já foi
   * atualizado pela operadora.
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


    if (!file) {
      return;
    }


    try {

      const data =
        await file.arrayBuffer();


      const workbook =
        XLSX.read(
          data,
          { type: "array" }
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
       * Coluna 1 = nome
       * Coluna 2 = número
       *
       * Também mantém detecção
       * automática como compatibilidade.
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


      const selectedOperator =
        currentOperator();


      const parsed =
        rows
          .slice(1)
          .map((row) => {

            const originalPhone =
              cleanPhone(
                row[phoneIndex]
              );


            /*
             * Assim que importa,
             * já aplica a operadora selecionada.
             */

            const finalPhone =
              applyOperator(
                originalPhone,
                selectedOperator
              );


            return {

              name:
                String(
                  row[nameIndex] ?? ""
                ).trim(),

              phone:
                finalPhone,

              status:
                "",

              called:
                false

            };

          })
          .filter(
            (contact) =>
              baseBrazilianNumber(
                contact.phone
              ).length >= 10
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
        "Não consegui ler a planilha. Verifique se a coluna 1 contém o nome e a coluna 2 contém o número."
      );

    }


    event.target.value = "";

  }
);


/* =========================================================
   BOTÃO ALTERAR OPERADORA
========================================================= */

$("changeOperatorBtn").addEventListener(
  "click",
  () => {

    updateNumbersForOperator();

  }
);


/* =========================================================
   LIGAR
========================================================= */

$("call").addEventListener(
  "click",
  openCurrent
);


/* =========================================================
   PRÓXIMO
========================================================= */

$("next").addEventListener(
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


/* =========================================================
   ANTERIOR
========================================================= */

$("prev").addEventListener(
  "click",
  () => {

    if (idx > 0) {

      idx--;

      saveLocal();

      render();

    }

  }
);


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

$("reset").addEventListener(
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


/* =========================================================
   NOVA LISTA
========================================================= */

$("newList").addEventListener(
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
      document.getElementById(
        "authMessage"
      );


    if (message) {

      message.textContent =
        error.message;

    }

  }

})();
