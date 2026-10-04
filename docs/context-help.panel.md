# context-help.panel

Displays an existing contextual-help snapshot in the persistent documentation dock.

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| Version     | `1.0.0`                                                                   |
| Provided by | `provideContextHelpPanel()` returning the panel service                   |
| Consumed by | `consumeContextHelpPanel(panel)` returning a `Disposable`                 |
| Owner       | [`documentation-view`](https://github.com/lumine-code/documentation-view) |

## Registration

Declare consumption in your `package.json`:

```json
{
  "consumedServices": {
    "context-help.panel": {
      "versions": { "^1.0.0": "consumeContextHelpPanel" }
    }
  }
}
```

Export `consumeContextHelpPanel(panel)` from your main module and return a `Disposable` that drops that service reference. Offer a handoff action only while the service is available.

## Contract

```ts
type ContextHelpPanel = {
  show(
    result: ContextHelpSnapshot,
    options?: { focus?: boolean },
  ): Promise<DocumentationView | null>;
};

type DocumentationView = {
  getTitle(): string;
  getURI(): string;
  getElement(): HTMLElement;
  onDidDestroy(callback: () => void): Disposable;
  destroy(): void;
};
```

`ContextHelpSnapshot` is defined in [context-help.registry](context-help.registry.md). `show()` renders that snapshot into the panel and reveals the dock. It does not ask providers again. By default, it preserves the existing focus; set `focus: true` to focus the panel. It resolves to the opened dock item, or `null` if the operation cannot finish. Its standard workspace-item methods allow observation without exposing the panel's internal rendering state.

## Minimal example

```js
const { Disposable } = require("lumine");

module.exports = {
  consumeContextHelpPanel(panel) {
    this.contextHelpPanel = panel;
    return new Disposable(() => {
      if (this.contextHelpPanel === panel) this.contextHelpPanel = null;
    });
  },

  async openAnswerInPanel() {
    const panel = this.contextHelpPanel;
    const result = this.currentAnswer;
    if (!panel || !result) return;
    await panel.show(result);
  },
};
```

## Behavior

The panel owns the new rendering. The caller can dispose its tooltip rendering after `show()` without affecting the panel's content. The snapshot retains the source editor and requested position, which need not be the current cursor position.

The panel keeps its last answer until another request replaces it or the user clears it. Cursor movement and switching files do not refresh it. Refresh requests help at the saved source position, clamping it to the current buffer after source edits; it never silently substitutes the active editor. The header indicates when the source has changed or closed. Returning to the editor focuses the currently active editor.

## Teardown

The consumer owns only its service reference. Disposing that edge does not close a panel the user has opened. The provider owns panel rendering cleanup and cancels unfinished rendering when a newer answer supersedes it or the package deactivates.

## Versioning

Provide `1.0.0` and consume `^1.0.0`. This is the first preproduction contract; consumers pass registry snapshots rather than tooltip DOM or provider implementations.
