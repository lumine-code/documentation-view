const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

beforeEach(() => {
  for (const method of ["openExternal", "openPath", "showItemInFolder", "openApplication"])
    if (!jasmine.isSpy(lumine.shell[method])) spyOn(lumine.shell, method).and.resolveTo();
  if (!jasmine.isSpy(lumine.application.openWindow))
    spyOn(lumine.application, "openWindow").and.resolveTo();
});

describe("Documentation source identity", () => {
  let main, editor, lease, scratch, temporary;
  beforeEach(async () => {
    const textGrammarPackage = await lumine.packages.activatePackage("language-text");
    await textGrammarPackage.resourceLoadPromise;
    jasmine.useRealClock();
    if (lumine.packages.isPackageLoaded("documentation-view"))
      await lumine.packages.unloadPackage("documentation-view");
    temporary = fs.realpathSync.native(os.tmpdir());
    scratch = fs.realpathSync.native(
      fs.mkdtempSync(path.join(temporary, "documentation-identity-")),
    );
    for (const name of ["before.txt", "after.txt"])
      fs.writeFileSync(path.join(scratch, name), "symbol\n");
    jasmine.attachToDOM(lumine.workspace.getElement());
    editor = await lumine.workspace.open(path.join(scratch, "before.txt"));
    editor.setCursorBufferPosition([0, 1]);
    main = (await lumine.packages.activatePackage("documentation-view")).mainModule;
  });
  afterEach(async () => {
    lease?.dispose();
    lease = null;
    if (lumine.packages.isPackageLoaded("documentation-view"))
      await lumine.packages.unloadPackage("documentation-view");
    editor?.destroy();
    await lumine.fileWatchClient.settlePendingTeardown();
    if (
      path.dirname(fs.realpathSync.native(scratch)) !== temporary ||
      !path.basename(scratch).startsWith("documentation-identity-")
    )
      throw new Error("Documentation fixture cleanup escaped its private temporary root");
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  async function prepare(kind) {
    if (kind === "grammar") {
      await lumine.packages.activatePackage("language-javascript");
      editor.setGrammar(lumine.grammars.grammarForScopeName("source.js"));
      expect(editor.getGrammar().scopeName).toBe("source.js");
    }
  }
  function change(kind) {
    if (kind === "path") editor.getBuffer().setPath(path.join(scratch, "after.txt"));
    else editor.setGrammar(lumine.grammars.grammarForScopeName("text.plain"));
  }
  for (const kind of ["path", "grammar"]) {
    it(`drops a fresh pending answer when its ${kind} changes without text or cursor edits`, async () => {
      await prepare(kind);
      const text = editor.getText(),
        point = editor.getCursorBufferPosition().copy();
      let finish, signal;
      lease = lumine.packages.serviceHub.provide("context-help.provider", "1.0.0", {
        getHelp(_editor, _position, options) {
          signal = options.signal;
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
      });
      const pending = lumine.commands.dispatch(editor.getElement(), "documentation-view:open");
      await conditionPromise(() => typeof finish === "function");
      change(kind);
      finish({ contents: { kind: "plaintext", value: "obsolete source answer" } });
      await pending;
      expect(editor.getText()).toBe(text);
      expect(editor.getCursorBufferPosition()).toEqual(point);
      expect(signal.aborted).toBe(true);
      expect(main.view.body.textContent).not.toContain("obsolete source answer");
    });
    it(`retains a transferred snapshot but marks its changed ${kind} during rendering`, async () => {
      await prepare(kind);
      let finish;
      const transfer = main.provideContextHelpPanel().show({
        editor,
        position: [0, 1],
        contents: [
          {
            render: () =>
              new Promise((resolve) => {
                finish = resolve;
              }),
          },
        ],
      });
      await conditionPromise(() => typeof finish === "function");
      change(kind);
      const element = document.createElement("div");
      element.textContent = "retained snapshot";
      finish(element);
      expect(await transfer).toBe(main.view);
      expect(main.view.body.textContent).toBe("retained snapshot");
      expect(main.view.sourceLabel.textContent).toContain("source changed");
    });
  }
  it("commits an ordinary pending answer whose source identity stays current", async () => {
    let finish;
    lease = lumine.packages.serviceHub.provide("context-help.provider", "1.0.0", {
      getHelp: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = lumine.commands.dispatch(editor.getElement(), "documentation-view:open");
    await conditionPromise(() => typeof finish === "function");
    finish({ contents: { kind: "plaintext", value: "current source answer" } });
    await pending;
    expect(main.view.body.textContent).toBe("current source answer");
    expect(main.view.sourceLabel.textContent).not.toContain("source changed");
  });
});
