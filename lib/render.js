// Provider results are reusable descriptions. Every rendering owns a fresh
// DOM tree and every resource in it, independently of the surface hosting it.
function scopeForFenceName(fenceName) {
  if (fenceName) {
    if (fenceName.includes(".") && lumine.grammars.grammarForScopeName(fenceName)) return fenceName;
    const grammar = lumine.grammars.treeSitterGrammarForLanguageString?.(fenceName);
    if (grammar) return grammar.scopeName;
    if (lumine.grammars.grammarForScopeName(`source.${fenceName}`)) return `source.${fenceName}`;
  }
  return "text.plain";
}

function ownEditors(element, disposeCallbacks) {
  const views = [...element.querySelectorAll("lumine-text-editor")];
  if (element.matches?.("lumine-text-editor")) views.unshift(element);
  const editors = views.map((view) => view.getModel());
  disposeCallbacks.push(() => {
    for (const editor of editors) if (!editor?.isDestroyed()) editor?.destroy();
  });
}

async function renderMarkdownFragment(markdown, renderCodeBlock, options, disposeCallbacks) {
  const html = lumine.tools.markdown.render(markdown, {
    renderMode: "fragment",
    html: false,
    breaks: false,
    handleFrontMatter: false,
    useTaskCheckbox: false,
    transformImageLinks: false,
    transformLegacyLinks: false,
    transformNonFqdnLinks: false,
  });
  if (!html.trim()) return null;
  const fragment = lumine.tools.markdown.convertToDOM(html);
  const replacements = [];
  if (typeof renderCodeBlock === "function") {
    for (const pre of fragment.querySelectorAll("pre")) {
      const code = pre.firstElementChild;
      const language = code?.className.replace(/^language-/, "");
      let rendered;
      try {
        rendered = await renderCodeBlock({
          text: (code ?? pre).textContent.replace(/\r?\n$/, ""),
          language,
          scopeName: scopeForFenceName(language),
        });
      } catch {
        // An ordinary syntax-highlighted fence is the fallback.
      }
      if (!rendered) continue;
      const element = rendered.element ?? rendered;
      if (rendered.dispose) disposeCallbacks.push(() => rendered.dispose());
      ownEditors(element, disposeCallbacks);
      const placeholder = document.createComment("provider code block");
      pre.replaceWith(placeholder);
      replacements.push({ placeholder, element });
    }
  }
  try {
    await lumine.tools.markdown.applySyntaxHighlighting(fragment, {
      renderMode: "fragment",
      syntaxScopeNameFunc: scopeForFenceName,
      autoWidth: options.autoWidth,
    });
  } finally {
    ownEditors(fragment, disposeCallbacks);
  }
  for (const { placeholder, element } of replacements) placeholder.replaceWith(element);
  return fragment;
}

async function renderContent(result, { autoWidth = false, signal } = {}) {
  if (signal?.aborted) return null;
  const element = document.createElement("div");
  element.className = "context-help-content";
  const disposeCallbacks = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const callback of disposeCallbacks.reverse()) {
      try {
        callback();
      } catch (error) {
        console.error(error);
      }
    }
    element.remove();
  };
  try {
    for (const contents of [result.contents].flat()) {
      if (signal?.aborted) break;
      const section = document.createElement("div");
      section.className = "context-help-section";
      if (typeof contents.render === "function") {
        const rendered = await contents.render();
        if (!rendered) continue;
        const node = rendered.element ?? rendered;
        if (rendered.dispose) disposeCallbacks.push(() => rendered.dispose());
        ownEditors(node, disposeCallbacks);
        section.classList.add("context-help-provided");
        section.appendChild(node);
      } else if (contents.kind === "plaintext") {
        if (!contents.value.trim()) continue;
        const text = document.createElement("div");
        text.className = "context-help-plaintext";
        text.textContent = contents.value;
        section.appendChild(text);
      } else {
        const fragment = await renderMarkdownFragment(
          contents.value,
          contents.renderCodeBlock,
          { autoWidth },
          disposeCallbacks,
        );
        if (!fragment) continue;
        section.appendChild(fragment);
      }
      element.appendChild(section);
    }
    if (signal?.aborted || !element.firstChild) {
      dispose();
      return null;
    }
    return { element, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

module.exports = { renderContent, scopeForFenceName };
