const ALLOWED_TAGS = new Set([
  "P", "BR", "DIV", "H1", "H2", "H3", "BLOCKQUOTE",
  "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "MARK", "SPAN",
  "UL", "OL", "LI", "HR"
]);
const ALLOWED_CLASSES = new Set(["editor-checklist", "editor-highlight", "todo-check", "note-title"]);
const ALLOWED_ATTRS = {
  LI: new Set(["data-checked"]),
  H1: new Set(["class", "data-placeholder"]),
  SPAN: new Set(["class", "contenteditable", "role", "aria-checked", "tabindex"])
};
const NEW_NOTE_HTML = '<h1 class="note-title" data-placeholder="标题"><br></h1><p><br></p>';
const MAX_HISTORY = 50;
const HISTORY_DEBOUNCE_MS = 800;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function looksLikeHtml(value) {
  return /<[a-z][\s\S]*>/i.test(String(value || ""));
}

function inlineMarkdownToHtml(line) {
  return escapeHtml(line)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>")
    .replace(/==(.+?)==/g, '<mark class="editor-highlight">$1</mark>')
    .replace(/<u>(.+?)<\/u>/gi, "<u>$1</u>");
}

function todoCheckMarkup(checked = false) {
  const value = checked ? "true" : "false";
  return `<span class="todo-check" contenteditable="false" role="checkbox" aria-checked="${value}" tabindex="-1"></span>`;
}

function checklistItemHtml(text, checked = false) {
  return `<li data-checked="${checked ? "true" : "false"}">${todoCheckMarkup(checked)}${inlineMarkdownToHtml(text)}</li>`;
}

function bodyToEditorHtml(body) {
  const raw = String(body || "");
  if (!raw.trim()) return "";
  if (looksLikeHtml(raw)) return sanitizeEditorHtml(raw);

  const lines = raw.split(/\r?\n/);
  const parts = [];

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed.trim()) {
      parts.push("<p><br></p>");
      continue;
    }
    if (/^---+$/.test(trimmed.trim())) {
      parts.push("<hr>");
      continue;
    }
    const checklist = trimmed.match(/^- \[( |x|X)\]\s+(.*)$/);
    if (checklist) {
      parts.push(`<ul class="editor-checklist">${checklistItemHtml(checklist[2], checklist[1] !== " ")}</ul>`);
      continue;
    }
    const bullet = trimmed.match(/^-\s+(.*)$/);
    if (bullet) {
      parts.push(`<ul><li>${inlineMarkdownToHtml(bullet[1])}</li></ul>`);
      continue;
    }
    const ordered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      parts.push(`<ol><li>${inlineMarkdownToHtml(ordered[1])}</li></ol>`);
      continue;
    }
    const h3 = trimmed.match(/^###\s+(.*)$/);
    if (h3) {
      parts.push(`<h3>${inlineMarkdownToHtml(h3[1])}</h3>`);
      continue;
    }
    const h2 = trimmed.match(/^##\s+(.*)$/);
    if (h2) {
      parts.push(`<h2>${inlineMarkdownToHtml(h2[1])}</h2>`);
      continue;
    }
    const h1 = trimmed.match(/^#\s+(.*)$/);
    if (h1) {
      parts.push(`<h1>${inlineMarkdownToHtml(h1[1])}</h1>`);
      continue;
    }
    const quote = trimmed.match(/^>\s+(.*)$/);
    if (quote) {
      parts.push(`<blockquote>${inlineMarkdownToHtml(quote[1])}</blockquote>`);
      continue;
    }
    parts.push(`<p>${inlineMarkdownToHtml(trimmed)}</p>`);
  }

  return sanitizeEditorHtml(parts.join(""));
}

function normalizeStyledSpans(root) {
  root.querySelectorAll("span[style]").forEach((span) => {
    const style = span.style;
    const weight = style.fontWeight;
    const bold = weight === "bold" || Number(weight) >= 600;
    const italic = style.fontStyle === "italic";
    const underline = style.textDecorationLine === "underline" || style.textDecoration.includes("underline");
    const strike = style.textDecorationLine === "line-through" || style.textDecoration.includes("line-through");

    let node = span;
    const wrap = (tag) => {
      const el = document.createElement(tag);
      while (node.firstChild) el.appendChild(node.firstChild);
      node.replaceWith(el);
      node = el;
    };

    if (bold) wrap("strong");
    if (italic) wrap("em");
    if (underline) wrap("u");
    if (strike) wrap("s");
    if (node === span && !span.attributes.length) {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      span.remove();
    }
  });
}

function ensureChecklistStructure(root) {
  root.querySelectorAll("ul.editor-checklist > li").forEach((li) => {
    if (!li.querySelector(".todo-check")) {
      const checked = li.getAttribute("data-checked") === "true";
      li.insertAdjacentHTML("afterbegin", todoCheckMarkup(checked));
    }
    const checked = li.getAttribute("data-checked") === "true";
    li.setAttribute("data-checked", checked ? "true" : "false");
    const box = li.querySelector(".todo-check");
    if (box) box.setAttribute("aria-checked", checked ? "true" : "false");
  });
}

function updateTitlePlaceholderState(root) {
  const title = root.querySelector("h1.note-title");
  if (!title) return;
  title.classList.toggle("is-empty", !title.textContent.trim());
}

export function sanitizeEditorHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = String(html || "");

  function clean(node) {
    const children = [...node.childNodes];
    for (const child of children) {
      if (child.nodeType === Node.TEXT_NODE) continue;
      if (child.nodeType !== Node.ELEMENT_NODE) {
        child.remove();
        continue;
      }
      const tag = child.tagName;
      if (!ALLOWED_TAGS.has(tag)) {
        const frag = document.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        clean(node);
        continue;
      }
      [...child.attributes].forEach((attr) => {
        const allowed = ALLOWED_ATTRS[tag];
        if (allowed?.has(attr.name)) return;
        if (attr.name === "class") {
          const kept = attr.value.split(/\s+/).filter((name) => ALLOWED_CLASSES.has(name));
          if (kept.length) child.setAttribute("class", kept.join(" "));
          else child.removeAttribute("class");
          return;
        }
        child.removeAttribute(attr.name);
      });
      clean(child);
    }
  }

  clean(template.content);
  const wrapper = document.createElement("motion-div" in document ? "div" : "div");
  wrapper.appendChild(template.content);
  normalizeStyledSpans(wrapper);
  ensureChecklistStructure(wrapper);
  return wrapper.innerHTML;
}

export function htmlToPlainText(html) {
  try {
    const root = document.createElement("div");
    root.innerHTML = sanitizeEditorHtml(html);
    root.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    root.querySelectorAll("hr").forEach((hr) => hr.replaceWith("\n---\n"));
    root.querySelectorAll("li").forEach((li) => {
      if (li.closest(".editor-checklist")) {
        const checked = li.getAttribute("data-checked") === "true";
        li.prepend(document.createTextNode(checked ? "- [x] " : "- [ ] "));
      } else if (li.closest("ol")) {
        li.prepend(document.createTextNode("1. "));
      } else {
        li.prepend(document.createTextNode("- "));
      }
    });
    root.querySelectorAll(".todo-check").forEach((node) => node.remove());
    return (root.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function isEditorContentEmpty(html) {
  return !htmlToPlainText(html).trim();
}

function resolveToolbar(toolbar) {
  if (toolbar instanceof HTMLElement) return toolbar;
  if (toolbar && typeof toolbar === "object") {
    return toolbar.toolbar || toolbar.dock || toolbar.formatSheet || toolbar.header || null;
  }
  return null;
}

export function createEditorController(root, toolbar, onChange) {
  if (!(root instanceof HTMLElement)) {
    throw new Error("editor root missing");
  }

  const toolbarEl = resolveToolbar(toolbar);
  const toolbarScrollEl = toolbarEl?.closest(".editor-toolbar-wrap") || toolbarEl;
  let history = [];
  let historyIndex = -1;
  let historyTimer = null;
  let savedRange = null;
  let inputHandler = null;
  let toolbarPointerDown = null;
  let toolbarPointerMove = null;
  let toolbarPointerUp = null;
  let toolbarPointerCancel = null;
  let toolbarClick = null;
  let pasteHandler = null;
  let checklistPointerHandler = null;
  let titleKeydownHandler = null;
  let selectionHandlers = [];
  let lastToolbarActivateAt = 0;
  let toolbarPress = null;

  function snapshot() {
    return { html: root.innerHTML };
  }

  function applySnapshot(snap) {
    root.innerHTML = snap.html || "";
    ensureChecklistStructure(root);
    updateTitlePlaceholderState(root);
    updateToolbarState();
    onChange?.();
  }

  function focusEditor() {
    root.focus({ preventScroll: true });
  }

  function saveSelection() {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    savedRange = range.cloneRange();
  }

  function restoreSelection() {
    if (!savedRange) return false;
    focusEditor();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
    return true;
  }

  function exec(cmd, value = null) {
    restoreSelection();
    try {
      document.execCommand("styleWithCSS", false, true);
    } catch {
      /* ignore */
    }
    document.execCommand(cmd, false, value);
  }

  function commitHistoryPoint() {
    history = history.slice(0, historyIndex + 1);
    history.push(snapshot());
    while (history.length > MAX_HISTORY) history.shift();
    historyIndex = history.length - 1;
  }

  function recordDebouncedHistory() {
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      historyTimer = null;
      const current = snapshot();
      const top = history[historyIndex];
      if (top && top.html === current.html) {
        updateToolbarState();
        return;
      }
      commitHistoryPoint();
      updateToolbarState();
    }, HISTORY_DEBOUNCE_MS);
  }

  function beforeMutation() {
    if (historyTimer) {
      clearTimeout(historyTimer);
      historyTimer = null;
    }
    const current = snapshot();
    const top = history[historyIndex];
    if (!top || top.html !== current.html) {
      commitHistoryPoint();
    } else {
      history = history.slice(0, historyIndex + 1);
    }
  }

  function afterMutation() {
    root.innerHTML = sanitizeEditorHtml(root.innerHTML);
    ensureChecklistStructure(root);
    updateTitlePlaceholderState(root);
    saveSelection();
    commitHistoryPoint();
    updateToolbarState();
    onChange?.();
  }

  function insertHtml(html) {
    restoreSelection();
    exec("insertHTML", html);
  }

  function formatTimestamp() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }

  function toggleWrap(tagName) {
    if (!restoreSelection()) return false;
    const sel = window.getSelection();
    if (!sel?.rangeCount || sel.isCollapsed) return false;

    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return false;

    let node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const existing = node?.closest?.(tagName.toUpperCase());
    if (existing && root.contains(existing)) {
      const parent = existing.parentNode;
      while (existing.firstChild) parent.insertBefore(existing.firstChild, existing);
      parent.removeChild(existing);
      saveSelection();
      return true;
    }

    const el = document.createElement(tagName);
    try {
      range.surroundContents(el);
    } catch {
      const fragment = range.extractContents();
      if (!fragment.textContent) return false;
      el.appendChild(fragment);
      range.insertNode(el);
    }

    const next = document.createRange();
    next.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(next);
    savedRange = next.cloneRange();
    return true;
  }

  function applyInline(tagName, execFallback) {
    beforeMutation();
    if (!toggleWrap(tagName)) {
      exec(execFallback);
    }
    afterMutation();
  }

  function toggleHighlight() {
    beforeMutation();
    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      insertHtml('<mark class="editor-highlight">文字</mark>');
      afterMutation();
      return;
    }

    const range = sel.getRangeAt(0);
    let node = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const existing = node?.closest?.("mark.editor-highlight, mark");
    if (existing && root.contains(existing)) {
      existing.replaceWith(document.createTextNode(existing.textContent));
      afterMutation();
      return;
    }

    try {
      const mark = document.createElement("mark");
      mark.className = "editor-highlight";
      range.surroundContents(mark);
      savedRange = range.cloneRange();
    } catch {
      exec("hiliteColor", "#f5e6a8");
    }
    afterMutation();
  }

  function toggleChecklistItem(li) {
    if (!li) return;
    beforeMutation();
    const checked = li.getAttribute("data-checked") === "true";
    const next = !checked;
    li.setAttribute("data-checked", next ? "true" : "false");
    const box = li.querySelector(".todo-check");
    if (box) box.setAttribute("aria-checked", next ? "true" : "false");
    afterMutation();
  }

  function toggleChecklist() {
    restoreSelection();
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;

    let block = sel.getRangeAt(0).commonAncestorContainer;
    if (block.nodeType === Node.TEXT_NODE) block = block.parentElement;
    const list = block?.closest?.("ul.editor-checklist");
    if (list && root.contains(list)) {
      beforeMutation();
      const p = document.createElement("p");
      p.textContent = list.querySelector("li")?.textContent?.trim() || "";
      list.replaceWith(p);
      afterMutation();
      return;
    }

    beforeMutation();
    const text = sel.toString() || "待办";
    insertHtml(`<ul class="editor-checklist">${checklistItemHtml(text, false)}</ul>`);
    afterMutation();
  }

  const commands = {
    undo() {
      if (historyIndex <= 0) return;
      if (historyTimer) {
        clearTimeout(historyTimer);
        historyTimer = null;
      }
      historyIndex -= 1;
      applySnapshot(history[historyIndex]);
    },
    redo() {
      if (historyIndex >= history.length - 1) return;
      if (historyTimer) {
        clearTimeout(historyTimer);
        historyTimer = null;
      }
      historyIndex += 1;
      applySnapshot(history[historyIndex]);
    },
    done() {
      root.blur();
    },
    timestamp() {
      beforeMutation();
      insertHtml(formatTimestamp());
      afterMutation();
    },
    bullet() {
      beforeMutation();
      exec("insertUnorderedList");
      afterMutation();
    },
    ordered() {
      beforeMutation();
      exec("insertOrderedList");
      afterMutation();
    },
    checklist() {
      toggleChecklist();
    },
    bold() {
      applyInline("strong", "bold");
    },
    italic() {
      applyInline("em", "italic");
    },
    underline() {
      applyInline("u", "underline");
    },
    strike() {
      applyInline("s", "strikeThrough");
    },
    highlight() {
      toggleHighlight();
    },
    h1() {
      beforeMutation();
      exec("formatBlock", "h1");
      afterMutation();
    },
    h2() {
      beforeMutation();
      exec("formatBlock", "h2");
      afterMutation();
    },
    h3() {
      beforeMutation();
      exec("formatBlock", "h3");
      afterMutation();
    },
    body() {
      beforeMutation();
      exec("formatBlock", "p");
      afterMutation();
    },
    quote() {
      beforeMutation();
      exec("formatBlock", "blockquote");
      afterMutation();
    },
    hr() {
      beforeMutation();
      exec("insertHorizontalRule");
      afterMutation();
    },
    indent() {
      beforeMutation();
      exec("indent");
      afterMutation();
    },
    outdent() {
      beforeMutation();
      exec("outdent");
      afterMutation();
    },
    selectAll() {
      focusEditor();
      const range = document.createRange();
      range.selectNodeContents(root);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      savedRange = range.cloneRange();
      updateToolbarState();
    }
  };

  function updateToolbarState() {
    if (!toolbarEl) return;
    const undoBtn = toolbarEl.querySelector('[data-cmd="undo"]');
    const redoBtn = toolbarEl.querySelector('[data-cmd="redo"]');
    if (undoBtn) undoBtn.disabled = historyIndex <= 0;
    if (redoBtn) redoBtn.disabled = historyIndex >= history.length - 1;
  }

  function run(cmd) {
    const fn = commands[cmd];
    if (!fn) return false;
    fn();
    return true;
  }

  function activateToolbarButton(button) {
    const now = Date.now();
    if (now - lastToolbarActivateAt < 300) return;
    lastToolbarActivateAt = now;
    run(button.dataset.cmd);
  }

  function getToolbarButton(event) {
    return event.target.closest("[data-cmd]");
  }

  toolbarPointerDown = (event) => {
    const button = getToolbarButton(event);
    if (button) saveSelection();
    toolbarPress = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      scrollLeft: toolbarScrollEl?.scrollLeft ?? 0,
      button: button || null,
      moved: false
    };
    if (event.pointerType === "mouse" && event.button === 0 && button) {
      event.preventDefault();
    }
  };

  toolbarPointerMove = (event) => {
    if (!toolbarPress || event.pointerId !== toolbarPress.id) return;
    const dx = Math.abs(event.clientX - toolbarPress.x);
    const dy = Math.abs(event.clientY - toolbarPress.y);
    if (dx > 4 || dy > 4) toolbarPress.moved = true;
  };

  toolbarPointerUp = (event) => {
    if (!toolbarPress || event.pointerId !== toolbarPress.id) return;
    const { button, x, moved, scrollLeft: startScroll } = toolbarPress;
    toolbarPress = null;
    const scrollMoved = Math.abs((toolbarScrollEl?.scrollLeft ?? 0) - startScroll) > 2;
    if (moved || scrollMoved || Math.abs(event.clientX - x) > 12) return;
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    activateToolbarButton(button);
  };

  toolbarPointerCancel = () => {
    toolbarPress = null;
  };

  toolbarClick = (event) => {
    const button = getToolbarButton(event);
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    activateToolbarButton(button);
  };

  pasteHandler = (event) => {
    event.preventDefault();
    const html = event.clipboardData?.getData("text/html");
    const text = event.clipboardData?.getData("text/plain") || "";
    beforeMutation();
    if (html) insertHtml(sanitizeEditorHtml(html));
    else document.execCommand("insertText", false, text);
    afterMutation();
  };

  checklistPointerHandler = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const check = event.target.closest(".todo-check");
    if (!check || !root.contains(check)) return;
    event.preventDefault();
    event.stopPropagation();
    toggleChecklistItem(check.closest("li"));
  };

  function focusTitle() {
    const title = root.querySelector("h1.note-title");
    if (!title) {
      focusEditor();
      return;
    }
    focusEditor();
    const range = document.createRange();
    range.selectNodeContents(title);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    savedRange = range.cloneRange();
  }

  function handleTitleEnter(event) {
    if (event.key !== "Enter") return;
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;

    let node = sel.anchorNode;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
    const title = node?.closest?.("h1.note-title");
    if (!title || !root.contains(title)) return;

    event.preventDefault();
    beforeMutation();

    let bodyBlock = title.nextElementSibling;
    if (!bodyBlock || bodyBlock.tagName === "BR") {
      bodyBlock = document.createElement("p");
      bodyBlock.appendChild(document.createElement("br"));
      title.after(bodyBlock);
    } else if (bodyBlock.tagName !== "P" && bodyBlock.tagName !== "DIV") {
      const p = document.createElement("p");
      p.appendChild(document.createElement("br"));
      title.insertAdjacentElement("afterend", p);
      bodyBlock = p;
    }

    const range = document.createRange();
    range.selectNodeContents(bodyBlock);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    savedRange = range.cloneRange();
    updateTitlePlaceholderState(root);
    afterMutation();
  }

  function setHtml(html) {
    root.innerHTML = bodyToEditorHtml(html);
    if (!root.innerHTML.trim()) root.innerHTML = "";
    ensureChecklistStructure(root);
    updateTitlePlaceholderState(root);
  }

  function reset(value = "") {
    if (historyTimer) {
      clearTimeout(historyTimer);
      historyTimer = null;
    }
    if (!String(value || "").trim()) {
      root.innerHTML = NEW_NOTE_HTML;
      ensureChecklistStructure(root);
      updateTitlePlaceholderState(root);
    } else {
      setHtml(value);
    }
    history = [snapshot()];
    historyIndex = 0;
    savedRange = null;
    updateToolbarState();
  }

  function getHtml() {
    return sanitizeEditorHtml(root.innerHTML);
  }

  function getText() {
    return htmlToPlainText(getHtml());
  }

  function isEmpty() {
    return isEditorContentEmpty(getHtml());
  }

  function destroy() {
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = null;
    if (toolbarScrollEl) {
      toolbarScrollEl.removeEventListener("pointerdown", toolbarPointerDown);
      toolbarScrollEl.removeEventListener("pointermove", toolbarPointerMove);
      toolbarScrollEl.removeEventListener("pointerup", toolbarPointerUp);
      toolbarScrollEl.removeEventListener("pointercancel", toolbarPointerCancel);
      toolbarScrollEl.removeEventListener("click", toolbarClick);
    }
    selectionHandlers.forEach(({ type, handler, options }) => {
      root.removeEventListener(type, handler, options);
    });
    selectionHandlers = [];
    if (inputHandler) root.removeEventListener("input", inputHandler);
    if (titleKeydownHandler) root.removeEventListener("keydown", titleKeydownHandler);
    root.removeEventListener("paste", pasteHandler);
    root.removeEventListener("pointerup", checklistPointerHandler);
    history = [];
    historyIndex = -1;
    savedRange = null;
  }

  function bind() {
    if (toolbarScrollEl) {
      toolbarScrollEl.addEventListener("pointerdown", toolbarPointerDown);
      toolbarScrollEl.addEventListener("pointermove", toolbarPointerMove);
      toolbarScrollEl.addEventListener("pointerup", toolbarPointerUp);
      toolbarScrollEl.addEventListener("pointercancel", toolbarPointerCancel);
      toolbarScrollEl.addEventListener("click", toolbarClick);
    }

    [
      ["mouseup", saveSelection],
      ["keyup", saveSelection],
      ["touchend", saveSelection, { passive: true }]
    ].forEach(([type, handler, options]) => {
      root.addEventListener(type, handler, options);
      selectionHandlers.push({ type, handler, options });
    });

    inputHandler = () => {
      updateTitlePlaceholderState(root);
      onChange?.();
      recordDebouncedHistory();
    };
    root.addEventListener("input", inputHandler);
    titleKeydownHandler = (event) => handleTitleEnter(event);
    root.addEventListener("keydown", titleKeydownHandler);
    root.addEventListener("paste", pasteHandler);
    root.addEventListener("pointerup", checklistPointerHandler);
    updateToolbarState();
  }

  bind();

  return { reset, destroy, run, updateToolbarState, getHtml, getText, isEmpty, focusTitle };
}
