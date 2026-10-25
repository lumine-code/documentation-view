describe("documentation-view startup restoration", () => {
  let pack;

  beforeEach(async () => {
    const textGrammarPackage = await lumine.packages.activatePackage("language-text");
    await textGrammarPackage.resourceLoadPromise;
    jasmine.useRealClock();
    if (lumine.packages.getLoadedPackage("documentation-view"))
      await lumine.packages.unloadPackage("documentation-view", { serialize: false });
    pack = lumine.packages.loadPackage("documentation-view");
    pack.initializeForExternalUse("startup restoration spec");
  });

  afterEach(async () => {
    if (lumine.packages.getLoadedPackage("documentation-view"))
      await lumine.packages.unloadPackage("documentation-view", { serialize: false });
  });

  it("keeps a restored panel and its service when activation follows", async () => {
    const main = pack.mainModule;
    const view = main.deserializeDocumentationView();
    const service = view.service;
    expect(service).toBeDefined();
    await lumine.packages.activatePackage("documentation-view");
    expect(main.ensureView()).toBe(view);
    expect(view.service).toBe(main.service);
    expect(main.service).toBe(service);
    const editor = await lumine.workspace.open();
    const edge = main.consumeContextHelp({
      getHelp: () => ({ contents: { value: "restored panel help" } }),
    });
    try {
      await view.request(editor, [0, 0]);
      expect(view.body.textContent).toContain("restored panel help");
    } finally {
      edge.dispose();
      editor.destroy();
    }
  });

  it("destroys a restored panel if startup stops before activation", async () => {
    const view = pack.mainModule.deserializeDocumentationView();
    await pack.deactivate();
    expect(view.destroyed).toBe(true);
  });

  it("retires the restored pane before unload finishes even when pane closure is delayed", async () => {
    const view = pack.mainModule.deserializeDocumentationView();
    const pane = lumine.workspace.getRightDock().getActivePane();
    pane.addItem(view);
    let release;
    const listener = pane.onWillDestroyItem(({ item }) => {
      if (item !== view) return;
      return new Promise((resolve) => (release = resolve));
    });
    let finished = false;
    const stopping = lumine.packages
      .unloadPackage("documentation-view", { serialize: false })
      .then(() => {
        finished = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      expect(finished && !view.destroyed).toBe(false);
      release?.();
      await stopping;
      expect(view.destroyed).toBe(true);
      expect(pane.getItems()).not.toContain(view);
      expect(view.subscriptions.disposed).toBe(true);
    } finally {
      release?.();
      listener.dispose();
      await stopping;
      view.destroy();
    }
  });
});
