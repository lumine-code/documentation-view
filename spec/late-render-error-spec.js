describe("Documentation panel render error lifetime", () => {
  let main, editor;

  beforeEach(async () => {
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open();
    editor.setText("documented symbol");
    main = (await lumine.packages.activatePackage("documentation-view")).mainModule;
    spyOn(lumine.notifications, "addWarning").and.callThrough();
    spyOn(console, "error");
  });

  function pending() {
    let reject,
      started = false;
    const waiting = new Promise((_resolve, fail) => (reject = fail));
    const showing = main.showResult({
      editor,
      position: [0, 0],
      contents: {
        render: () => {
          started = true;
          return waiting;
        },
      },
    });
    return { showing, reject, started: () => started };
  }

  it("does not notify a replacement activation about an old render failure", async () => {
    const request = pending();
    await conditionPromise(request.started, "provider rendering started");
    await lumine.packages.deactivatePackage("documentation-view");
    const current = await lumine.packages.activatePackage("documentation-view");

    request.reject(new Error("retired provider failure"));
    await expectAsync(request.showing).toBeResolvedTo(null);

    expect(lumine.notifications.addWarning).not.toHaveBeenCalled();
    expect(current.mainModule.view).toBeNull();
  });

  it("does not replace a newer answer with a warning from an old render", async () => {
    const request = pending();
    await conditionPromise(request.started, "provider rendering started");
    await main.showResult({
      editor,
      position: [0, 0],
      contents: { kind: "plaintext", value: "Current help" },
    });

    request.reject(new Error("superseded provider failure"));
    await request.showing;

    expect(main.view.body.textContent).toBe("Current help");
    expect(lumine.notifications.addWarning).not.toHaveBeenCalled();
  });

  it("keeps the existing warning for a current render failure", async () => {
    const request = pending();
    await conditionPromise(request.started, "provider rendering started");
    request.reject(new Error("live provider failure"));
    await expectAsync(request.showing).toBeResolvedTo(null);

    expect(lumine.notifications.addWarning).toHaveBeenCalledWith(
      "Documentation could not be displayed.",
    );
  });

  it("respects a real Clear command dispatched while previous content is disposed", async () => {
    const element = document.createElement("div");
    element.textContent = "Old custom help";
    await main.showResult({
      editor,
      position: [0, 0],
      contents: {
        render: () => ({
          element,
          dispose: () => lumine.commands.dispatch(main.view.element, "documentation-view:clear"),
        }),
      },
    });
    const replacement = document.createElement("div");
    replacement.textContent = "Late replacement help";
    const dispose = jasmine.createSpy("replacement disposer");

    const result = await main.showResult({
      editor,
      position: [0, 0],
      contents: { render: () => ({ element: replacement, dispose }) },
    });

    expect(result).toBeNull();
    expect(main.view.source).toBeNull();
    expect(main.view.body.textContent).not.toContain("Late replacement help");
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
