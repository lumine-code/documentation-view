const { CompositeDisposable } = require("lumine");

const deferred = () => {
  let resolve;
  const promise = new Promise((callback) => {
    resolve = callback;
  });
  return { promise, resolve };
};

describe("context-help registry", () => {
  let main, service, editor, disposables;
  beforeEach(async () => {
    await lumine.packages.activatePackage("documentation-view");
    main = lumine.packages.getActivePackage("documentation-view").mainModule;
    service = main.provideContextHelpRegistry();
    editor = await lumine.workspace.open();
    editor.setText("word other\nnext line");
    disposables = new CompositeDisposable();
  });
  afterEach(() => {
    disposables.dispose();
    lumine.packages.deactivatePackage("documentation-view");
    if (!editor.isDestroyed()) editor.destroy();
  });
  function add(provider) {
    disposables.add(main.consumeContextHelp(provider));
  }

  it("aggregates matching providers by priority and intersects their ranges", async () => {
    add({
      priority: 1,
      getHelp: () => ({
        contents: { value: "docs" },
        range: [
          [0, 0],
          [0, 4],
        ],
      }),
    });
    add({
      priority: 100,
      getHelp: () => ({
        contents: { value: "warning" },
        range: [
          [0, 1],
          [0, 3],
        ],
      }),
    });
    add({
      grammarScopes: ["unrelated.scope"],
      getHelp: () => {
        throw new Error("wrong grammar");
      },
    });
    const result = await service.request(editor, [0, 2]);
    expect(result.contents.map((contents) => contents.value)).toEqual(["warning", "docs"]);
    expect(result.range.serialize()).toEqual([
      [0, 1],
      [0, 3],
    ]);
  });

  it("re-reads grammar scopes when a provider gains an editor", async () => {
    let scopes = [];
    add({
      get grammarScopes() {
        return scopes;
      },
      getHelp: () => ({ contents: { value: "dynamic" } }),
    });
    expect(await service.request(editor, [0, 1])).toBeNull();
    scopes = [editor.getGrammar().scopeName];
    expect((await service.request(editor, [0, 1])).contents[0].value).toBe("dynamic");
  });

  it("asks row providers only for gutter help", async () => {
    const text = jasmine.createSpy("getHelp");
    const row = jasmine
      .createSpy("getGutterHelp")
      .and.returnValue({ contents: { value: "row help" } });
    add({ getHelp: text, getGutterHelp: row });
    const result = await service.request(editor, [0, 2], { gutter: true });
    expect(text).not.toHaveBeenCalled();
    expect(row.calls.mostRecent().args[1]).toBe(0);
    expect(result.range.serialize()).toEqual([
      [0, 0],
      [0, 10],
    ]);
  });

  it("does not let a stale range hide another provider's answer", async () => {
    add({
      getHelp: () => ({
        contents: { value: "wrong" },
        range: [
          [1, 0],
          [1, 3],
        ],
      }),
    });
    add({ getHelp: () => ({ contents: { value: "valid" } }) });
    expect(
      (await service.request(editor, [0, 1])).contents.map((contents) => contents.value),
    ).toEqual(["valid"]);
  });

  it("isolates a failing provider", async () => {
    spyOn(console, "error");
    add({
      priority: 2,
      getHelp: () => {
        throw new Error("provider failed");
      },
    });
    add({ getHelp: () => ({ contents: { value: "remaining" } }) });
    expect((await service.request(editor, [0, 1])).contents[0].value).toBe("remaining");
    expect(console.error).toHaveBeenCalled();
  });

  it("drops a provider that disappears while its answer is pending", async () => {
    const pending = deferred();
    const edge = main.consumeContextHelp({ getHelp: () => pending.promise });
    const request = service.request(editor, [0, 1]);
    edge.dispose();
    pending.resolve({ contents: { value: "removed" } });
    expect(await request).toBeNull();
  });

  it("keeps two consumers' cancellation independent", async () => {
    const pending = [];
    const signals = [];
    add({
      getHelp: (_editor, _position, { signal }) => {
        const entry = deferred();
        pending.push(entry);
        signals.push(signal);
        return entry.promise;
      },
    });
    const controller = new AbortController();
    const tooltip = service.request(editor, [0, 1], { signal: controller.signal });
    const panel = service.request(editor, [0, 2]);
    controller.abort();
    pending[0].resolve({ contents: { value: "old" } });
    pending[1].resolve({ contents: { value: "panel" } });
    expect(await tooltip).toBeNull();
    expect((await panel).contents[0].value).toBe("panel");
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("invalidates pending answers when source text changes", async () => {
    const pending = deferred();
    add({ getHelp: () => pending.promise });
    const request = service.request(editor, [0, 1]);
    editor.insertText("changed");
    pending.resolve({ contents: { value: "old text" } });
    expect(await request).toBeNull();
  });

  it("invalidates the old facade after package deactivation and reactivation", async () => {
    const pending = deferred();
    add({ getHelp: () => pending.promise });
    const request = service.request(editor, [0, 1]);
    lumine.packages.deactivatePackage("documentation-view");
    await lumine.packages.activatePackage("documentation-view");
    main = lumine.packages.getActivePackage("documentation-view").mainModule;
    pending.resolve({ contents: { value: "discarded generation" } });
    expect(await request).toBeNull();
    expect(await service.request(editor, [0, 1])).toBeNull();
    expect(await service.render({ contents: [{ value: "old facade" }] })).toBeNull();
  });

  it("renders independent interactive sections from one result", async () => {
    let clicks = 0;
    const cleanup = jasmine.createSpy("dispose");
    const render = () => {
      const element = document.createElement("button");
      element.textContent = "interactive";
      element.addEventListener("click", () => clicks++);
      return { element, dispose: cleanup };
    };
    add({ getHelp: () => ({ contents: { render } }) });
    const result = await service.request(editor, [0, 1]);
    const first = await service.render(result);
    const second = await service.render(result);
    first.element.querySelector("button").click();
    second.element.querySelector("button").click();
    expect(clicks).toBe(2);
    expect(first.element).not.toBe(second.element);
    first.dispose();
    first.dispose();
    expect(cleanup).toHaveBeenCalledTimes(1);
    second.dispose();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it("renders plaintext literally and neutralizes raw HTML in markdown", async () => {
    const rendered = await service.render({
      contents: [
        { kind: "plaintext", value: "<b>literal</b>\n**plain**" },
        { value: "<script>untrusted()</script>\n\n**markdown**" },
      ],
    });
    expect(rendered.element.querySelector(".context-help-plaintext").textContent).toContain(
      "<b>literal</b>",
    );
    expect(rendered.element.querySelector("script")).toBeNull();
    expect(rendered.element.querySelector("strong").textContent).toBe("markdown");
    rendered.dispose();
  });

  it("destroys fenced-code editors on disposal", async () => {
    const rendered = await service.render({ contents: [{ value: "```text\nexample\n```" }] });
    const model = rendered.element.querySelector("lumine-text-editor").getModel();
    expect(model.isDestroyed()).toBe(false);
    rendered.dispose();
    expect(model.isDestroyed()).toBe(true);
  });

  it("cleans a custom rendering that finishes after cancellation", async () => {
    const pending = deferred();
    const cleanup = jasmine.createSpy("dispose");
    const controller = new AbortController();
    const render = service.render(
      { contents: [{ render: () => pending.promise }] },
      { signal: controller.signal },
    );
    controller.abort();
    pending.resolve({ element: document.createElement("div"), dispose: cleanup });
    expect(await render).toBeNull();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
