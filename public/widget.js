(() => {
  const script = document.currentScript;
  const chatbotId = script?.dataset.chatbotId;
  const widgetAlreadyExists = [...document.querySelectorAll("[data-frontdesk-widget]")].some(
    (element) => element.dataset.frontdeskWidget === chatbotId,
  );
  if (!script || !chatbotId || widgetAlreadyExists) return;

  const appUrl = new URL(script.src).origin;
  const hosted = script.dataset.hosted === "true";
  const host = document.createElement("div");
  host.dataset.frontdeskWidget = chatbotId;
  if (hosted) host.classList.add("hosted");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; color: #202333; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; line-height: 1.45; }
    *, *::before, *::after { box-sizing: border-box; }
    .launcher { position: fixed; z-index: 2147483000; bottom: 20px; right: 20px; border: 0; border-radius: 999px; width: 60px; height: 60px; background: var(--brand); color: white; box-shadow: 0 8px 24px #25234d30; font-size: 24px; cursor: pointer; }
    .panel { position: fixed; z-index: 2147483000; bottom: 92px; right: 20px; width: 380px; height: min(560px, calc(100dvh - 112px)); min-height: 400px; overflow: hidden; display: none; grid-template-rows: auto 1fr auto; background: #fff; border: 1px solid #e7e8ee; border-radius: 20px; box-shadow: 0 18px 60px #1e24402b; }
    .panel.open { display: grid; }
    .header { display: flex; align-items: center; gap: 12px; padding: 16px; color: white; background: var(--brand); }
    .avatar { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 38px; border-radius: 50%; background: #ffffff30; font-weight: 700; }
    .avatar img { display: block; width: 100%; height: 100%; border-radius: inherit; object-fit: cover; }
    .header-copy { min-width: 0; flex: 1; }
    .header-copy strong, .header-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .header-copy small { margin-top: 2px; opacity: .82; }
    .close { border: 0; color: white; background: transparent; font-size: 25px; cursor: pointer; }
    .messages { overflow-y: auto; padding: 16px; background: #fafaff; }
    .message { width: fit-content; max-width: 88%; padding: 10px 12px; margin-bottom: 10px; border-radius: 14px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .message.assistant { background: white; border: 1px solid #e9eaf0; border-top-left-radius: 4px; }
    .message.user { margin-left: auto; color: white; background: var(--brand); border-top-right-radius: 4px; }
    .welcome { color: #35384a; }
    .citations { display: flex; flex-wrap: wrap; gap: 6px; margin: -5px 0 12px; }
    .citations a { max-width: 100%; padding: 4px 8px; overflow: hidden; color: #5547bd; background: #f0efff; border-radius: 999px; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .starters { display: flex; flex-wrap: wrap; gap: 7px; margin: 4px 0 12px; }
    .starter { padding: 7px 10px; border: 1px solid #deddf7; border-radius: 999px; color: #5145aa; background: white; cursor: pointer; font: inherit; font-size: 12px; }
    .composer { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #ececf1; background: white; }
    .composer input { min-width: 0; flex: 1; padding: 11px 12px; border: 1px solid #dfe1e8; border-radius: 11px; outline-color: var(--brand); color: #202333; background: white; font: inherit; }
    .send { width: 42px; border: 0; border-radius: 11px; color: white; background: var(--brand); font-size: 18px; cursor: pointer; }
    .send:disabled, .composer input:disabled { opacity: .55; cursor: wait; }
    .error { padding: 10px; color: #9f3434; background: #fff2f0; border-radius: 10px; }
    .powered { padding: 0 12px 8px; color: #9699a6; text-align: center; font-size: 10px; }
    :host(.left) .launcher { left: 20px; right: auto; }
    :host(.left) .panel { left: 20px; right: auto; }
    :host(.hosted) { position: fixed; z-index: 2147483000; inset: 0; display: grid; place-items: center; pointer-events: none; background: #13172c12; }
    :host(.hosted) .panel { position: relative; inset: auto; display: grid; width: min(440px, calc(100vw - 32px)); height: min(680px, calc(100dvh - 32px)); border-radius: 22px; pointer-events: auto; }
    :host(.hosted) .launcher { display: none; }
    :host(.hosted) .close { display: none; }
    @media (max-width: 520px) { .panel { right: 10px; bottom: 80px; width: calc(100vw - 20px); height: min(620px, calc(100dvh - 92px)); } :host(.left) .panel { left: 10px; } .launcher { right: 12px; bottom: 12px; } :host(.left) .launcher { left: 12px; } :host(.hosted) .panel { width: 100vw; height: 100dvh; border: 0; border-radius: 0; } }
  `;
  shadow.append(style);

  const launcher = document.createElement("button");
  launcher.className = "launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open chat with assistant");
  launcher.textContent = "✦";
  const panel = document.createElement("section");
  panel.className = `panel${hosted ? " open" : ""}`;
  panel.setAttribute("aria-label", "Chat with assistant");
  panel.setAttribute("aria-live", "polite");
  panel.innerHTML = `<div class="header"><span class="avatar">F</span><div class="header-copy"><strong>FrontDesk</strong><small>Typically replies instantly</small></div><button class="close" type="button" aria-label="Close chat">×</button></div><div class="messages"></div><div><div class="powered">Powered by FrontDesk</div><form class="composer"><input name="question" maxlength="2000" placeholder="Ask a question…" aria-label="Your question" autocomplete="off"><button class="send" type="submit" aria-label="Send message">↑</button></form></div>`;
  shadow.append(launcher, panel);
  document.body.append(host);

  const messages = panel.querySelector(".messages");
  const input = panel.querySelector("input");
  const form = panel.querySelector("form");
  const sendButton = panel.querySelector(".send");
  const storageKey = `frontdesk:visitor:${chatbotId}`;
  let conversationId = null;
  try {
    conversationId = sessionStorage.getItem(storageKey);
  } catch {
    // The visitor can still chat if browser storage is disabled.
  }
  let config;
  let pending = false;

  function addMessage(role, content, citations = []) {
    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    bubble.textContent = content;
    messages.append(bubble);
    if (citations.length) {
      const links = document.createElement("div");
      links.className = "citations";
      for (const citation of citations) {
        const link = document.createElement("a");
        link.textContent = citation.sourceName || "Source";
        const url = typeof citation.sourceUrl === "string" ? citation.sourceUrl : "";
        link.href = /^https?:\/\//i.test(url) ? url : `${appUrl}/b/${chatbotId}`;
        link.target = "_blank";
        link.rel = "noreferrer";
        links.append(link);
      }
      messages.append(links);
    }
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function showError(message) {
    const error = document.createElement("div");
    error.className = "error";
    error.textContent = message;
    messages.append(error);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderWelcome() {
    const bubble = document.createElement("div");
    bubble.className = "message assistant welcome";
    bubble.textContent = config.config.welcomeMessage;
    messages.append(bubble);
    const starters = config.config.starterQuestions || [];
    if (starters.length) {
      const group = document.createElement("div");
      group.className = "starters";
      for (const question of starters) {
        const button = document.createElement("button");
        button.className = "starter";
        button.type = "button";
        button.textContent = question;
        button.addEventListener("click", () => sendQuestion(question));
        group.append(button);
      }
      messages.append(group);
    }
  }

  function parseFrame(frame) {
    const event = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim() || "message";
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    try {
      return { event, data: JSON.parse(data) };
    } catch {
      return null;
    }
  }

  async function sendQuestion(value) {
    const question = value.trim();
    if (!question || pending) return;
    pending = true;
    input.disabled = true;
    sendButton.disabled = true;
    addMessage("user", question);
    input.value = "";
    const answer = addMessage("assistant", "…");
    let text = "";
    try {
      const response = await fetch(`${appUrl}/api/chatbots/${chatbotId}/chat`, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ question, conversationId }),
      });
      if (!response.ok || !response.body) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "The assistant could not answer. Please retry.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let citations = [];
      function handleFrame(frame) {
        const parsed = parseFrame(frame);
        if (!parsed) return;
        const { event, data } = parsed;
        if (event === "conversation" && typeof data.conversationId === "string") {
          conversationId = data.conversationId;
          try {
            sessionStorage.setItem(storageKey, conversationId);
          } catch {
            // Conversation memory is optional when browser storage is disabled.
          }
        } else if (event === "delta" && typeof data.delta === "string") {
          text += data.delta;
          answer.textContent = text;
          messages.scrollTop = messages.scrollHeight;
        } else if (event === "replace" && typeof data.answer === "string") {
          text = data.answer;
          answer.textContent = text;
        } else if (event === "done") {
          text = typeof data.answer === "string" ? data.answer : text;
          answer.textContent = text;
          citations = Array.isArray(data.citations) ? data.citations : [];
        }
      }
      while (true) {
        const { done, value: bytes } = await reader.read();
        if (done) break;
        buffer += decoder.decode(bytes, { stream: true });
        let split = buffer.match(/\r?\n\r?\n/);
        while (split?.index !== undefined) {
          handleFrame(buffer.slice(0, split.index));
          buffer = buffer.slice(split.index + split[0].length);
          split = buffer.match(/\r?\n\r?\n/);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) handleFrame(buffer);
      if (citations.length) {
        const links = document.createElement("div");
        links.className = "citations";
        for (const citation of citations) {
          const link = document.createElement("a");
          link.textContent = citation.sourceName || "Source";
          const url = typeof citation.sourceUrl === "string" ? citation.sourceUrl : "";
          link.href = /^https?:\/\//i.test(url) ? url : `${appUrl}/b/${chatbotId}`;
          link.target = "_blank";
          link.rel = "noreferrer";
          links.append(link);
        }
        messages.append(links);
      }
    } catch (error) {
      answer.remove();
      showError(error instanceof Error ? error.message : "The assistant could not answer.");
    } finally {
      pending = false;
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  }

  launcher.addEventListener("click", () => {
    panel.classList.toggle("open");
    const open = panel.classList.contains("open");
    launcher.setAttribute("aria-expanded", String(open));
    if (open) input.focus();
  });
  panel.querySelector(".close").addEventListener("click", () => {
    panel.classList.remove("open");
    launcher.setAttribute("aria-expanded", "false");
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !hosted) {
      panel.classList.remove("open");
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
    }
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendQuestion(input.value);
  });

  fetch(`${appUrl}/api/public/bots/${chatbotId}/config`, { mode: "cors", credentials: "omit" })
    .then(async (response) => {
      if (!response.ok) throw new Error("This website is not enabled for this chatbot yet.");
      config = await response.json();
      host.style.setProperty("--brand", config.config.color || "#7065e8");
      host.classList.toggle("left", config.config.position === "left");
      panel.querySelector(".header-copy strong").textContent = config.name;
      const avatar = panel.querySelector(".avatar");
      avatar.textContent = config.name.slice(0, 1).toUpperCase();
      if (
        typeof config.config.avatarUrl === "string" &&
        config.config.avatarUrl.startsWith("https://")
      ) {
        const image = document.createElement("img");
        image.src = config.config.avatarUrl;
        image.alt = "";
        image.referrerPolicy = "no-referrer";
        image.addEventListener(
          "error",
          () => {
            avatar.textContent = config.name.slice(0, 1).toUpperCase();
          },
          { once: true },
        );
        avatar.replaceChildren(image);
      }
      launcher.setAttribute("aria-label", `Chat with ${config.name}`);
      renderWelcome();
    })
    .catch((error) => {
      panel.querySelector(".header-copy strong").textContent = "Chat unavailable";
      panel.querySelector(".messages").textContent = error.message;
      panel.querySelector(".messages").classList.add("error");
    });
})();
