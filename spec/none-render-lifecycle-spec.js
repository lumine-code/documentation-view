describe("Documentation rendering across None transitions", () => {
  let editor, main, service, grammar;
  beforeEach(async () => {
    const pkg = await lumine.packages.activatePackage("language-text");
    await pkg.resourceLoadPromise;
    editor = await lumine.workspace.open();
    grammar = editor.getGrammar();
    main = (await lumine.packages.activatePackage("documentation-view")).mainModule;
    service = main.provideContextHelpRegistry();
  });
  afterEach(() => editor.destroy());

  it("retires public rendering and allows fresh help before an obsolete renderer finishes", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const dispose = jasmine.createSpy("dispose old help");
    const next = jasmine.createSpy("next renderer").and.returnValue(document.createElement("p"));
    const pending = service.render({
      editor,
      contents: [{ render: () => gate }, { render: next }],
    });
    editor.setGrammar(lumine.grammars.nullGrammar);
    editor.setGrammar(grammar);
    const fresh = await service.render({ editor, contents: { kind: "plaintext", value: "Fresh" } });
    expect(fresh.element.textContent).toBe("Fresh");
    release({ element: document.createElement("p"), dispose });
    const stale = await pending;
    expect(stale).toBeNull();
    expect(next).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledTimes(1);
    stale?.dispose();
    fresh.dispose();
  });

  it("stops later code-block renderers and syntax highlighting after None", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    const renderCodeBlock = jasmine.createSpy("code block").and.returnValue(gate);
    const highlighting = spyOn(lumine.tools.markdown, "applySyntaxHighlighting").and.callThrough();
    const pending = service.render({
      editor,
      contents: { value: "```text\nfirst\n```\n\n```text\nsecond\n```", renderCodeBlock },
    });
    editor.setGrammar(lumine.grammars.nullGrammar);
    release(document.createElement("pre"));
    await expectAsync(pending).toBeResolvedTo(null);
    expect(renderCodeBlock).toHaveBeenCalledTimes(1);
    expect(highlighting).not.toHaveBeenCalled();
  });

  it("does not start a deferred panel request after a same-grammar roundtrip", async () => {
    let release;
    const gate = new Promise((resolve) => (release = resolve));
    spyOn(main, "reveal").and.returnValue(gate);
    const view = main.ensureView();
    const request = spyOn(view, "request").and.resolveTo();
    const pending = main.openAtCursor();
    editor.setGrammar(lumine.grammars.nullGrammar);
    editor.setGrammar(grammar);
    release();
    await pending;
    expect(request).not.toHaveBeenCalled();
    await main.openAtCursor();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
