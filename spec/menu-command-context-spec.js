const path = require("node:path");
const packageRoot = path.join(__dirname, "..");

describe("documentation-view menu commands in captured presentation contexts", () => {
  let main, first, second, firstPane, notebook, lease, captured;

  beforeEach(async () => {
    jasmine.useRealClock();
    for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
      if (!jasmine.isSpy(lumine.shell[method])) spyOn(lumine.shell, method).and.resolveTo();
    if (!jasmine.isSpy(lumine.application.openWindow))
      spyOn(lumine.application, "openWindow").and.resolveTo();
    jasmine.attachToDOM(lumine.workspace.getElement());
    first = await lumine.workspace.open();
    firstPane = lumine.workspace.paneForItem(first);
    second = lumine.workspace.buildTextEditor();
    main = (await lumine.packages.activatePackage(packageRoot)).mainModule;
    captured = jasmine
      .createSpy("request captured documentation")
      .and.returnValue({ contents: { value: "Captured docs" } });
    lease = main.consumeContextHelp({ getHelp: captured });
    spyOn(main, "reveal").and.resolveTo();
  });

  afterEach(async () => {
    lease?.dispose();
    await lumine.packages.deactivatePackage("documentation-view");
    await lumine.workspace.discardEditorWindows();
    if (notebook) await lumine.workspace.paneForItem(notebook)?.destroyItem(notebook);
    first?.destroy();
    second?.destroy();
    main = first = second = firstPane = notebook = lease = captured = null;
  });

  it("offers symbol help on a document editor while panel toggles remain global", async () => {
    const workspace = lumine.workspace.getElement();
    expect(lumine.commands.canDispatch(workspace, "documentation-view:toggle")).toBe(true);
    expect(lumine.commands.canDispatch(workspace, "documentation-view:open")).toBe(false);
    expect(lumine.commands.canDispatch(first.getElement(), "documentation-view:open")).toBe(true);
    const mini = lumine.workspace.buildTextEditor({ mini: true });
    workspace.appendChild(mini.getElement());
    expect(lumine.commands.canDispatch(mini.getElement(), "documentation-view:open")).toBe(false);
    mini.destroy();

    await lumine.commands.dispatch(first.getElement(), "documentation-view:open");

    expect(captured).toHaveBeenCalledTimes(1);
    expect(captured.calls.argsFor(0)[0]).toBe(first);
  });

  it("does not redirect a window control to the document in that window", async () => {
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    extra.getEditorContainer().getActivePane().activateItem(second, { activatePane: true });
    firstPane.activate();
    firstPane.activateItem(first);
    const button = extra.getDocument().createElement("button");
    extra.getElement().appendChild(button);
    expect(lumine.workspace.getActiveTextEditor()).toBe(first);

    await lumine.commands.dispatch(button, "documentation-view:open");

    expect(lumine.commands.canDispatch(button, "documentation-view:open")).toBe(false);
    expect(captured).not.toHaveBeenCalled();
  });

  it("does not redirect a notebook control to its active cell editor", async () => {
    const element = document.createElement("div");
    const button = document.createElement("button");
    element.appendChild(button);
    notebook = {
      element,
      getTitle: () => "Command Context Notebook",
      getActiveEmbeddedTextEditor: () => second,
    };
    const pane = firstPane.splitRight();
    pane.activateItem(notebook, { activatePane: true });
    firstPane.activate();
    firstPane.activateItem(first);
    const context = lumine.workspace.resolveCommandContext(button);
    expect(context.editor).toBeUndefined();
    expect(context.embeddedEditor).toBe(second);
    expect(lumine.workspace.getActiveTextEditor()).toBe(first);

    await lumine.commands.dispatch(button, "documentation-view:open");

    expect(lumine.commands.canDispatch(button, "documentation-view:open")).toBe(false);
    expect(captured).not.toHaveBeenCalled();
  });

  it("does not select a shared main editor when the invoking presentation has no document", async () => {
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    firstPane.activate();
    firstPane.activateItem(first);
    const button = extra.getDocument().createElement("button");
    extra.getElement().appendChild(button);
    expect(lumine.workspace.getActiveTextEditor()).toBe(first);

    await lumine.commands.dispatch(button, "documentation-view:open");

    expect(captured).not.toHaveBeenCalled();
  });
});
