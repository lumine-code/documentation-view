const { CompositeDisposable } = require("lumine");

function deferred() {
  let resolve;
  const promise = new Promise((callback) => {
    resolve = callback;
  });
  return { promise, resolve };
}

describe("documentation panel request lifecycle", () => {
  let main, editor, editorView, disposables;
  beforeEach(async () => {
    jasmine.attachToDOM(lumine.views.getView(lumine.workspace));
    await lumine.packages.activatePackage("documentation-view");
    main = lumine.packages.getActivePackage("documentation-view").mainModule;
    editor = await lumine.workspace.open();
    editor.setText("first second");
    editorView = lumine.views.getView(editor);
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
  function snapshot(contents) {
    return { editor, position: [0, 1], contents: [contents] };
  }

  it("does not report a snapshot transfer as successful when Clear supersedes it", async () => {
    const pending = deferred();
    const view = main.ensureView();
    await main.reveal(view);
    const result = snapshot({ render: () => pending.promise });
    const transfer = main.provideContextHelpPanel().show(result);
    await conditionPromise(() => view.controller !== null);
    view.clear();
    pending.resolve(document.createElement("div"));
    expect(await transfer).toBeNull();
    expect(view.element.hasAttribute("aria-busy")).toBe(false);
    expect(view.source).toBeNull();
  });

  it("does not report an unrenderable snapshot as successfully displayed", async () => {
    expect(await main.provideContextHelpPanel().show(snapshot({ value: "   " }))).toBeNull();
  });

  it("lets the latest command win even when dock opening completes out of order", async () => {
    const openings = [deferred(), deferred()];
    spyOn(main, "reveal").and.returnValues(openings[0].promise, openings[1].promise);
    add((_editor, position) => ({ contents: { value: `position ${position.column}` } }));
    editor.setCursorBufferPosition([0, 1]);
    const first = main.openAtCursor({ target: editorView });
    editor.setCursorBufferPosition([0, 8]);
    const second = main.openAtCursor({ target: editorView });
    openings[1].resolve();
    await second;
    openings[0].resolve();
    await first;
    expect(main.view.body.textContent).toContain("position 8");
    expect(main.view.source.position.column).toBe(8);
  });

  it("clears the busy state when a snapshot supersedes a pending fetch", async () => {
    const pending = deferred();
    add(() => pending.promise);
    const view = main.ensureView();
    await main.reveal(view);
    const request = view.request(editor, [0, 1]);
    expect(view.element.hasAttribute("aria-busy")).toBe(true);
    await main.provideContextHelpPanel().show(snapshot({ value: "snapshot" }));
    expect(view.element.hasAttribute("aria-busy")).toBe(false);
    expect(view.body.textContent).toContain("snapshot");
    await request;
    pending.resolve(null);
  });

  it("marks a source change while a transferred snapshot is rendering", async () => {
    const pending = deferred();
    const view = main.ensureView();
    await main.reveal(view);
    const transfer = view.showResult(snapshot({ render: () => pending.promise }));
    editor.insertText("changed");
    const node = document.createElement("div");
    node.textContent = "retained snapshot";
    pending.resolve(node);
    expect(await transfer).toBe(true);
    expect(view.body.textContent).toContain("retained snapshot");
    expect(view.sourceLabel.textContent).toContain("source changed");
  });

  it("drops a fresh request if its source changes during rendering", async () => {
    const pending = deferred();
    add(() => ({ contents: { render: () => pending.promise } }));
    const view = main.ensureView();
    const cleanup = jasmine.createSpy("dispose");
    const request = view.request(editor, [0, 1]);
    await conditionPromise(() => pending.promise && main.registry.requests.size === 0);
    editor.insertText("changed");
    pending.resolve({ element: document.createElement("div"), dispose: cleanup });
    await request;
    expect(view.source).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the active file while retaining help from another file", async () => {
    add(() => ({ contents: { value: "original help" } }));
    await main.openAtCursor({ target: editorView });
    const other = await lumine.workspace.open();
    const otherView = lumine.views.getView(other);
    await main.toggleFocus();
    await main.toggleFocus();
    expect(lumine.workspace.getActiveTextEditor()).toBe(other);
    expect(otherView.hasFocus()).toBe(true);
    expect(main.view.body.textContent).toContain("original help");
    other.destroy();
  });
});
