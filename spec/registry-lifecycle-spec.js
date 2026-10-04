const { CompositeDisposable } = require("lumine");

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("context-help provider lifecycle", () => {
  let main, registry, editor, disposables, customEditors;

  beforeEach(async () => {
    await lumine.packages.activatePackage("documentation-view");
    main = lumine.packages.getActivePackage("documentation-view").mainModule;
    registry = main.provideContextHelpRegistry();
    editor = await lumine.workspace.open();
    editor.setText("word other");
    disposables = new CompositeDisposable();
    customEditors = [];
  });

  afterEach(() => {
    disposables.dispose();
    lumine.packages.deactivatePackage("documentation-view");
    for (const customEditor of customEditors) {
      if (!customEditor.isDestroyed()) customEditor.destroy();
    }
    if (!editor.isDestroyed()) editor.destroy();
  });

  function add(provider) {
    const edge = main.consumeContextHelp(provider);
    disposables.add(edge);
    return edge;
  }

  function buildCustomEditor() {
    const customEditor = lumine.workspace.buildTextEditor();
    customEditor.setText("custom help");
    customEditors.push(customEditor);
    return customEditor;
  }

  it("excludes an old reply when the same provider object is registered again", async () => {
    const pending = deferred();
    const provider = { getHelp: () => pending.promise };
    const originalEdge = add(provider);
    const request = registry.request(editor, [0, 1]);
    originalEdge.dispose();
    add(provider);
    pending.resolve({ contents: { value: "old registration" } });
    expect(await request).toBeNull();
    expect((await registry.request(editor, [0, 1])).contents[0].value).toBe("old registration");
  });

  it("does not call a provider removed while an earlier provider is pending", async () => {
    const pending = deferred();
    add({ priority: 1, getHelp: () => pending.promise });
    const removed = jasmine
      .createSpy("removed getHelp")
      .and.returnValue({ contents: { value: "removed" } });
    const removedEdge = add({ getHelp: removed });
    const request = registry.request(editor, [0, 1]);
    removedEdge.dispose();
    pending.resolve({ contents: { value: "remaining" } });
    expect((await request).contents.map((content) => content.value)).toEqual(["remaining"]);
    expect(removed).not.toHaveBeenCalled();
  });

  it("drops an earlier answer whose provider disappears before aggregation finishes", async () => {
    const started = deferred();
    const pending = deferred();
    const earlyEdge = add({
      priority: 1,
      getHelp: () => ({ contents: { value: "early" } }),
    });
    add({
      getHelp() {
        started.resolve();
        return pending.promise;
      },
    });
    const request = registry.request(editor, [0, 1]);
    await started.promise;
    earlyEdge.dispose();
    pending.resolve({ contents: { value: "later" } });
    expect((await request).contents.map((content) => content.value)).toEqual(["later"]);
  });

  it("settles an aborted request even when the provider ignores its signal", async () => {
    add({ getHelp: () => new Promise(() => {}) });
    const controller = new AbortController();
    const request = registry.request(editor, [0, 1], { signal: controller.signal });
    controller.abort();
    let timer;
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => resolve("request did not settle"), 100);
    });
    try {
      expect(await Promise.race([request, deadline])).toBeNull();
    } finally {
      clearTimeout(timer);
    }
  });

  it("isolates a provider whose range cannot be normalized", async () => {
    const error = new Error("malformed range");
    spyOn(console, "error");
    add({
      priority: 1,
      getHelp: () => ({
        contents: { value: "invalid" },
        range: {
          get start() {
            throw error;
          },
          end: [0, 4],
        },
      }),
    });
    add({ getHelp: () => ({ contents: { value: "valid" } }) });
    expect((await registry.request(editor, [0, 1])).contents[0].value).toBe("valid");
    expect(console.error).toHaveBeenCalledWith(error);
  });

  it("isolates a throwing grammar-scope getter without invoking that provider", async () => {
    const error = new Error("scope lookup failed");
    const getHelp = jasmine.createSpy("unavailable getHelp");
    spyOn(console, "error");
    add({
      get grammarScopes() {
        throw error;
      },
      getHelp,
    });
    add({ getHelp: () => ({ contents: { value: "valid" } }) });
    expect((await registry.request(editor, [0, 1])).contents[0].value).toBe("valid");
    expect(getHelp).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(error);
  });

  it("destroys an editor returned as the custom content root", async () => {
    const customEditor = buildCustomEditor();
    const rendered = await registry.render({
      contents: [{ render: () => lumine.views.getView(customEditor) }],
    });
    disposables.add(rendered);
    expect(customEditor.isDestroyed()).toBe(false);
    rendered.dispose();
    expect(customEditor.isDestroyed()).toBe(true);
  });

  it("continues custom and editor cleanup after a provider disposer throws", async () => {
    const customEditor = buildCustomEditor();
    const cleanup = jasmine.createSpy("remaining cleanup");
    const error = new Error("provider cleanup failed");
    spyOn(console, "error");
    const rendered = await registry.render({
      contents: [
        {
          render: () => ({ element: lumine.views.getView(customEditor), dispose: cleanup }),
        },
        {
          render: () => ({
            element: document.createElement("div"),
            dispose() {
              throw error;
            },
          }),
        },
      ],
    });
    disposables.add(rendered);
    rendered.dispose();
    expect(customEditor.isDestroyed()).toBe(true);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(error);
    rendered.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
