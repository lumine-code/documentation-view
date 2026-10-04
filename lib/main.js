const { CompositeDisposable } = require("lumine");
const Registry = require("./registry");

const URI = "lumine://documentation-view";

module.exports = {
  activate() {
    this.registry = new Registry();
    const registry = this.registry;
    this.view = null;
    this.active = true;
    this.service = Object.freeze({
      request: (...args) => registry.request(...args),
      render: async (...args) => {
        if (registry.disposed) return null;
        const { renderContent } = require("./render");
        const rendered = await renderContent(...args);
        if (registry.disposed) {
          rendered?.dispose();
          return null;
        }
        return rendered;
      },
    });
    this.panelService = Object.freeze({
      show: (result, options) =>
        registry.disposed ? Promise.resolve(null) : this.showResult(result, options),
    });
    this.subscriptions = new CompositeDisposable(
      lumine.workspace.addOpener((uri) => (uri === URI ? this.ensureView() : undefined)),
      lumine.commands.add("lumine-workspace", {
        "documentation-view:open": {
          description: "Keep the help for the symbol under the cursor in a dock panel.",
          didDispatch: (event) => this.openAtCursor(event),
        },
        "documentation-view:toggle": () => this.toggle(),
        "documentation-view:toggle-focus": () => this.toggleFocus(),
      }),
    );
  },

  deactivate() {
    this.active = false;
    this.subscriptions?.dispose();
    this.subscriptions = null;
    this.registry?.dispose();
    this.registry = null;
    if (this.view) {
      const pane = lumine.workspace.paneForItem(this.view);
      if (pane) pane.destroyItem(this.view);
      else this.view.destroy();
    }
    this.service = null;
    this.panelService = null;
  },

  consumeContextHelp(provider) {
    return this.registry.addProvider(provider);
  },
  provideContextHelpRegistry() {
    return this.service;
  },
  provideContextHelpPanel() {
    return this.panelService;
  },
  provideBackgroundTips() {
    return {
      packageName: "documentation-view",
      tips: [
        "{% if keys['documentation-view:open'] %}You can keep the documentation under the cursor in a side panel with {{ 'documentation-view:open' | keystroke }}{% else %}You can keep the documentation under the cursor in a side panel with Documentation View: Open.{% endif %}",
      ],
    };
  },

  ensureView() {
    if (!this.view) {
      const DocumentationView = require("./documentation-view");
      const view = new DocumentationView(this.service);
      this.view = view;
      view.onDidDestroy(() => {
        if (this.view === view) this.view = null;
      });
    }
    return this.view;
  },

  deserializeDocumentationView() {
    return this.ensureView();
  },

  async reveal(view, { focus = false } = {}) {
    await lumine.workspace.open(view, {
      searchAllPanes: true,
      activatePane: false,
      activateItem: true,
    });
    if (!this.active || view.destroyed) return;
    const container = lumine.workspace.paneContainerForItem(view);
    container?.show();
    if (focus) view.focus();
  },

  async openAtCursor(event) {
    const editor =
      lumine.workspace.getTextEditorForElement(event?.target, { includeMini: false }) ??
      lumine.workspace.getFocusedTextEditor({ includeMini: false }) ??
      lumine.workspace.getActiveTextEditor();
    if (!editor) return;
    const position = editor.getCursorBufferPosition().copy();
    const view = this.ensureView();
    view.cancelRequest();
    const generation = view.generation;
    await this.reveal(view);
    if (this.active && !view.destroyed && generation === view.generation) {
      await view.request(editor, position);
    }
  },

  async showResult(result, options) {
    if (!this.active || !result) return null;
    const view = this.ensureView();
    view.cancelRequest();
    const generation = view.generation;
    await this.reveal(view, options);
    if (!this.active || view.destroyed || generation !== view.generation) return null;
    try {
      const committed = await view.showResult(result);
      return committed && this.active && !view.destroyed ? view : null;
    } catch (error) {
      console.error(error);
      lumine.notifications.addWarning("Documentation could not be displayed.");
      return null;
    }
  },

  async toggle() {
    const view = this.view;
    const container = view && lumine.workspace.paneContainerForItem(view);
    if (container?.isVisible()) container.hide();
    else await this.reveal(this.ensureView());
  },

  async toggleFocus() {
    const view = this.ensureView();
    if (view.element.contains(document.activeElement)) view.returnToEditor();
    else await this.reveal(view, { focus: true });
  },
};
