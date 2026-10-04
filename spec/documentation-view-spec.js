const { CompositeDisposable } = require("lumine");

describe("documentation-view", () => {
  let main, editor, editorView, disposables;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    await lumine.packages.activatePackage("documentation-view");
    main = lumine.packages.getActivePackage("documentation-view").mainModule;
    editor = await lumine.workspace.open();
    editor.setText("first second");
    editor.setCursorBufferPosition([0, 1]);
    editorView = lumine.views.getView(editor);
    editorView.focus();
    disposables = new CompositeDisposable();
  });
  afterEach(() => {
    disposables.dispose();
    lumine.packages.deactivatePackage("documentation-view");
    if (!editor.isDestroyed()) editor.destroy();
  });
  function add(getHelp) {
    disposables.add(main.consumeContextHelp({ getHelp }));
  }

  it("creates no panel until requested and opens help without stealing focus", async () => {
    expect(main.view).toBeNull();
    add(() => ({ contents: { value: "**first docs**" } }));
    await main.openAtCursor({ target: editorView });
    expect(main.view.body.textContent).toContain("first docs");
    expect(lumine.workspace.paneContainerForItem(main.view).getLocation()).toBe("right");
    expect(editorView.hasFocus()).toBe(true);
  });

  it("retains help when the cursor and active file change", async () => {
    const getHelp = jasmine
      .createSpy("getHelp")
      .and.returnValue({ contents: { value: "retained" } });
    add(getHelp);
    await main.openAtCursor({ target: editorView });
    editor.setCursorBufferPosition([0, 8]);
    const other = await lumine.workspace.open();
    expect(main.view.body.textContent).toContain("retained");
    expect(getHelp).toHaveBeenCalledTimes(1);
    other.destroy();
  });

  it("refreshes the retained source position rather than the current cursor", async () => {
    const positions = [];
    add((_editor, position) => {
      positions.push(position.column);
      return { contents: { value: `docs ${positions.length}` } };
    });
    await main.openAtCursor({ target: editorView });
    editor.setCursorBufferPosition([0, 8]);
    await main.view.refresh();
    expect(positions).toEqual([1, 1]);
    expect(main.view.body.textContent).toContain("docs 2");
  });

  it("renders the tooltip snapshot without requesting providers again", async () => {
    const getHelp = jasmine
      .createSpy("getHelp")
      .and.returnValue({ contents: { value: "snapshot" } });
    add(getHelp);
    const result = await main.service.request(editor, [0, 8]);
    await main.provideContextHelpPanel().show(result);
    expect(getHelp).toHaveBeenCalledTimes(1);
    expect(main.view.body.textContent).toContain("snapshot");
    expect(main.view.source.position.column).toBe(8);
  });

  it("marks source edits while keeping the retained content readable", async () => {
    add(() => ({ contents: { value: "original" } }));
    await main.openAtCursor({ target: editorView });
    editor.insertText("changed");
    expect(main.view.body.textContent).toContain("original");
    expect(main.view.sourceLabel.textContent).toContain("source changed");
  });

  it("keeps content after source closure and disables refresh", async () => {
    add(() => ({ contents: { value: "retained" } }));
    await main.openAtCursor({ target: editorView });
    editor.destroy();
    expect(main.view.body.textContent).toContain("retained");
    expect(main.view.sourceLabel.textContent).toContain("source closed");
    expect(main.view.refreshButton.disabled).toBe(true);
  });

  it("shows an explicit empty result instead of keeping unrelated previous help", async () => {
    add((_editor, position) => (position.column === 1 ? { contents: { value: "first" } } : null));
    await main.openAtCursor({ target: editorView });
    editor.setCursorBufferPosition([0, 8]);
    await main.openAtCursor({ target: editorView });
    expect(main.view.body.textContent).toContain("No contextual help");
    expect(main.view.body.textContent).not.toContain("first");
  });

  it("focuses the panel and returns to its source editor", async () => {
    add(() => ({ contents: { value: "docs" } }));
    await main.openAtCursor({ target: editorView });
    await main.toggleFocus();
    expect(main.view.element.contains(document.activeElement)).toBe(true);
    await main.toggleFocus();
    expect(editorView.hasFocus()).toBe(true);
  });

  it("resolves a registered embedded editor from the dispatch target", async () => {
    const fragment = lumine.workspace.buildTextEditor();
    fragment.setText("embedded");
    const view = lumine.views.getView(fragment);
    const registration = lumine.textEditors.add(fragment, { role: "fragment" });
    const getHelp = jasmine
      .createSpy("getHelp")
      .and.returnValue({ contents: { value: "cell docs" } });
    add(getHelp);
    await main.openAtCursor({ target: view });
    expect(getHelp.calls.mostRecent().args[0]).toBe(fragment);
    expect(main.view.body.textContent).toContain("cell docs");
    registration.dispose();
    fragment.destroy();
  });

  it("drops late replies after panel closure and recreates a clean panel", async () => {
    let resolve;
    const pending = new Promise((callback) => {
      resolve = callback;
    });
    add(() => pending);
    const view = main.ensureView();
    await main.reveal(view);
    const request = view.request(editor, [0, 1]);
    lumine.workspace.paneForItem(view).destroyItem(view);
    resolve({ contents: { value: "late" } });
    await request;
    expect(main.view).toBeNull();
    expect(view.destroyed).toBe(true);
    expect(main.ensureView()).not.toBe(view);
  });

  it("destroys old code editors when replacing or clearing a result", async () => {
    add(() => ({ contents: { value: "```text\ncode\n```" } }));
    await main.openAtCursor({ target: editorView });
    const first = main.view.body.querySelector("lumine-text-editor").getModel();
    await main.openAtCursor({ target: editorView });
    expect(first.isDestroyed()).toBe(true);
    const second = main.view.body.querySelector("lumine-text-editor").getModel();
    main.view.clear();
    expect(second.isDestroyed()).toBe(true);
  });

  it("restores the dock shell without serializing provider DOM", async () => {
    add(() => ({ contents: { value: "docs" } }));
    await main.openAtCursor({ target: editorView });
    const state = main.view.serialize();
    expect(state).toEqual({ deserializer: "documentation-view/DocumentationView" });
    expect(main.deserializeDocumentationView(state)).toBe(main.view);
  });
});
