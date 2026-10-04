const { CompositeDisposable, Emitter, Point } = require("lumine");
const path = require("path");

module.exports = class DocumentationView {
  constructor(service) {
    this.service = service;
    this.destroyed = false;
    this.generation = 0;
    this.rendered = null;
    this.source = null;
    this.sourceSubscriptions = null;
    this.emitter = new Emitter();
    this.element = document.createElement("div");
    this.element.className = "documentation-view tool-panel";
    this.element.tabIndex = -1;
    this.element.setAttribute("data-context-menu-boundary", "");
    this.header = document.createElement("div");
    this.header.className = "documentation-view-header";
    this.sourceLabel = document.createElement("span");
    this.sourceLabel.className = "documentation-view-source";
    this.header.appendChild(this.sourceLabel);
    this.refreshButton = this.button("Refresh", "sync", () => this.refresh());
    this.clearButton = this.button("Clear", "trashcan", () => this.clear());
    this.header.append(this.refreshButton, this.clearButton);
    this.body = document.createElement("div");
    this.body.className = "documentation-view-body";
    this.body.tabIndex = 0;
    this.element.append(this.header, this.body);
    this.subscriptions = new CompositeDisposable(
      lumine.commands.add(".documentation-view", {
        "documentation-view:refresh": {
          description: "Request fresh help for the retained source position.",
          didDispatch: () => this.refresh(),
        },
        "documentation-view:clear": () => this.clear(),
        "documentation-view:return-to-editor": () => this.returnToEditor(),
        "core:copy": (event) => {
          const selection = window.getSelection();
          if (selection?.isCollapsed || !this.body.contains(selection?.anchorNode)) return;
          lumine.clipboard.write(selection.toString());
          event.stopImmediatePropagation();
        },
      }),
    );
    this.clear();
  }

  button(label, icon, handler) {
    const button = document.createElement("button");
    button.className = `btn btn-xs icon icon-${icon}`;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", handler);
    return button;
  }

  getTitle() {
    return "Documentation";
  }
  getURI() {
    return "lumine://documentation-view";
  }
  getIconName() {
    return "book";
  }
  getDefaultLocation() {
    return "right";
  }
  getAllowedLocations() {
    return ["right", "left", "bottom"];
  }
  getElement() {
    return this.element;
  }
  serialize() {
    return { deserializer: "documentation-view/DocumentationView" };
  }
  onDidDestroy(callback) {
    return this.emitter.on("did-destroy", callback);
  }
  focus() {
    this.body.focus();
  }

  returnToEditor() {
    const editor = lumine.workspace.getActiveTextEditor();
    if (editor && !editor.isDestroyed()) lumine.views.getView(editor).focus();
    else lumine.workspace.getCenter().activate();
  }

  cancelRequest() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.element.removeAttribute("aria-busy");
  }

  rememberSource(result) {
    this.sourceSubscriptions?.dispose();
    const { editor, gutter } = result;
    this.source = { editor, position: Point.fromObject(result.position).copy(), gutter };
    this.stale = false;
    this.sourceSubscriptions = new CompositeDisposable(
      editor.getBuffer().onDidChangeText(() => {
        this.stale = true;
        this.updateHeader();
      }),
      editor.onDidDestroy(() => this.updateHeader()),
      editor.onDidChangePath(() => this.updateHeader()),
    );
    this.updateHeader();
  }

  updateHeader() {
    if (!this.source) {
      this.sourceLabel.textContent = "No documentation selected";
      this.sourceLabel.title = "";
      this.refreshButton.disabled = true;
      return;
    }
    const { editor, position } = this.source;
    const name = editor.getPath() ? path.basename(editor.getPath()) : "Untitled";
    const suffix = editor.isDestroyed()
      ? " — source closed"
      : this.stale
        ? " — source changed"
        : "";
    this.sourceLabel.textContent = `${name}:${position.row + 1}:${position.column + 1}${suffix}`;
    this.sourceLabel.title = editor.getPath() ?? name;
    this.refreshButton.disabled = editor.isDestroyed();
  }

  status(message) {
    const status = document.createElement("p");
    status.className = "documentation-view-status text-subtle";
    status.textContent = message;
    this.body.replaceChildren(status);
  }

  async request(editor, position, { gutter = false } = {}) {
    this.cancelRequest();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const sourceSubscriptions = new CompositeDisposable(
      editor.onDidDestroy(() => controller.abort()),
      editor.getBuffer().onDidChangeText(() => controller.abort()),
    );
    this.element.setAttribute("aria-busy", "true");
    try {
      const result = await this.service.request(editor, position, {
        gutter,
        signal: controller.signal,
      });
      if (this.destroyed || generation !== this.generation || controller.signal.aborted) return;
      const committed = result && (await this.renderResult(result, controller.signal, generation));
      if (this.destroyed || generation !== this.generation || controller.signal.aborted) return;
      if (!committed) {
        this.rendered?.dispose();
        this.rendered = null;
        this.rememberSource({ editor, position, gutter });
        this.status("No contextual help is available at this position.");
      }
    } catch (error) {
      if (this.destroyed || generation !== this.generation || controller.signal.aborted) return;
      console.error(error);
      lumine.notifications.addWarning("Documentation could not be loaded.");
    } finally {
      sourceSubscriptions.dispose();
      if (generation === this.generation) {
        this.element.removeAttribute("aria-busy");
        this.controller = null;
      }
    }
  }

  async showResult(result) {
    this.cancelRequest();
    const controller = new AbortController();
    this.controller = controller;
    const generation = this.generation;
    let changed = false;
    const subscription = result.editor.getBuffer().onDidChangeText(() => {
      changed = true;
    });
    this.element.setAttribute("aria-busy", "true");
    try {
      const committed = await this.renderResult(result, controller.signal, generation);
      if (committed && changed) {
        this.stale = true;
        this.updateHeader();
      }
      return committed;
    } finally {
      subscription.dispose();
      if (generation === this.generation) {
        this.controller = null;
        this.element.removeAttribute("aria-busy");
      }
    }
  }

  async renderResult(result, signal, generation) {
    const rendered = await this.service.render(result, { autoWidth: false, signal });
    if (!rendered) return false;
    if (this.destroyed || generation !== this.generation || signal.aborted) {
      rendered.dispose();
      return false;
    }
    this.rendered?.dispose();
    this.rendered = rendered;
    this.rememberSource(result);
    this.body.replaceChildren(rendered.element);
    return true;
  }

  async refresh() {
    if (!this.source) return;
    const { editor, position, gutter } = this.source;
    if (editor.isDestroyed()) {
      lumine.notifications.addWarning("The documentation source editor has been closed.");
      return;
    }
    await this.request(editor, editor.clipBufferPosition(position), { gutter });
  }

  clear() {
    this.cancelRequest();
    this.element.removeAttribute("aria-busy");
    this.rendered?.dispose();
    this.rendered = null;
    this.sourceSubscriptions?.dispose();
    this.sourceSubscriptions = null;
    this.source = null;
    this.updateHeader();
    this.status("Run Documentation View: Open to read help for the symbol under the cursor.");
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.clear();
    this.subscriptions.dispose();
    this.element.remove();
    this.emitter.emit("did-destroy");
    this.emitter.dispose();
  }
};
