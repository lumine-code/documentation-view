# context-help.registry

Requests and renders the combined contextual help supplied by registered providers.

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| Version     | `1.0.0`                                                                   |
| Provided by | `provideContextHelpRegistry()` returning the registry                     |
| Consumed by | `consumeContextHelpRegistry(registry)` returning a `Disposable`           |
| Owner       | [`documentation-view`](https://github.com/lumine-code/documentation-view) |

## Registration

Declare consumption in your `package.json`:

```json
{
  "consumedServices": {
    "context-help.registry": {
      "versions": { "^1.0.0": "consumeContextHelpRegistry" }
    }
  }
}
```

Export `consumeContextHelpRegistry(registry)` from your main module and return a `Disposable` that drops the reference and cancels work belonging to that service edge. Consumption is passive; it does not activate the provider package.

## Contract

```ts
type ContextHelpSnapshot = {
  contents: ContextHelpContent[];
  range: Range | null;
  editor: TextEditor;
  position: Point;
  gutter: boolean;
};

type ContextHelpRendering = {
  element: HTMLElement;
  dispose(): void;
};

type ContextHelpRegistry = {
  request(
    editor: TextEditor,
    position: Point,
    options?: { gutter?: boolean; signal?: AbortSignal },
  ): Promise<ContextHelpSnapshot | null>;
  render(
    result: ContextHelpSnapshot,
    options?: { autoWidth?: boolean; signal?: AbortSignal },
  ): Promise<ContextHelpRendering | null>;
};
```

`ContextHelpContent` is defined in [context-help.provider](context-help.provider.md). A snapshot preserves source context and content data; it contains no mounted DOM. `request()` returns `null` when there is no answer or the call is cancelled. Set `gutter: true` to ask providers about the position's buffer row through their gutter method.

`render()` builds a fresh `.context-help-content` element with one section per content item. Markdown is sanitized and code fences use syntax-highlighted embedded editors; plain text stays plain. Custom content factories are invoked separately for each rendering. Set `autoWidth: true` for a tooltip whose code blocks should size to their contents; dock rendering uses the default `false`.

## Minimal example

```js
const { Disposable } = require("lumine");

module.exports = {
  consumeContextHelpRegistry(registry) {
    this.contextHelpRegistry = registry;
    return new Disposable(() => {
      if (this.contextHelpRegistry !== registry) return;
      this.requestController?.abort();
      this.rendering?.dispose();
      this.rendering = null;
      this.contextHelpRegistry = null;
    });
  },

  async showHelp(editor, position) {
    const registry = this.contextHelpRegistry;
    if (!registry) return;
    this.requestController?.abort();
    const controller = new AbortController();
    this.requestController = controller;
    const result = await registry.request(editor, position, {
      signal: controller.signal,
    });
    if (!result) return;
    const rendering = await registry.render(result, {
      signal: controller.signal,
    });
    if (!rendering) return;
    this.rendering?.dispose();
    this.rendering = rendering;
    this.element.replaceChildren(rendering.element);
  },
};
```

## Behavior

Requests collect all matching providers in descending priority order. Provider failures are isolated and logged; removing a registration excludes its pending answer. Each call has its own cancellation signal, so requests for a tooltip and a dock do not supersede one another. The consumer controls whether its own newer request cancels its previous one. Editing or destroying the source editor cancels unfinished requests so an answer for the previous buffer contents cannot replace current help.

Rendering the same snapshot twice creates independent DOM and resources. A panel can display the exact snapshot already shown by a tooltip, without a second provider request or moving the tooltip's DOM. Cursor movement, file switches, and later provider requests do not mutate that snapshot.

## Teardown

Dispose each rendering when its surface is replaced or destroyed. Abort pending request and render work when the surface closes or its consumed service disappears. The rendering disposer is safe to call more than once and owns embedded editors and custom content cleanup.

Provider registration belongs to [context-help.provider](context-help.provider.md), not to the registry service. The registry exposes no provider list or registration method to UI consumers.

## Versioning

Provide `1.0.0` and consume `^1.0.0`. This is the first preproduction contract. The provider API describes content independently of its presentation; tooltip and panel consumers migrate together when an incompatible change is made.
