describe("Documentation retained-source command availability", () => {
  let view;
  beforeEach(async () => {
    const textGrammarPackage = await lumine.packages.activatePackage("language-text");
    await textGrammarPackage.resourceLoadPromise;
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("documentation-view");
    view = await lumine.workspace.open("lumine://documentation-view");
  });
  it("tracks retained source lifetime like the Refresh button", async () => {
    expect(lumine.commands.canDispatch(view.element, "documentation-view:refresh")).toBe(false);
    const editor = lumine.workspace.buildTextEditor();
    view.rememberSource({ editor, position: [0, 0] });
    expect(lumine.commands.canDispatch(view.element, "documentation-view:refresh")).toBe(true);
    expect(view.refreshButton.disabled).toBe(false);
    editor.destroy();
    expect(lumine.commands.canDispatch(view.element, "documentation-view:refresh")).toBe(false);
    expect(view.refreshButton.disabled).toBe(true);
  });
});
