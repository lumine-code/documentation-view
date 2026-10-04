# context-help.provider

Supplies contextual help for a buffer position or a whole gutter row.

|             |                                                                           |
| ----------- | ------------------------------------------------------------------------- |
| Version     | `1.0.0`                                                                   |
| Provided by | `provideContextHelp()` returning one provider                             |
| Consumed by | `consumeContextHelp(provider)` returning a `Disposable`                   |
| Owner       | [`documentation-view`](https://github.com/lumine-code/documentation-view) |

## Registration

Declare the service in your `package.json`:

```json
{
  "providedServices": {
    "context-help.provider": {
      "versions": { "1.0.0": "provideContextHelp" }
    }
  }
}
```

Publish the provider during synchronous package bootstrap. Keep expensive lookups inside `getHelp()` and `getGutterHelp()`.

## Contract

```ts
type ContextHelpProvider = {
  getHelp(
    editor: TextEditor,
    position: Point,
    options?: { signal?: AbortSignal },
  ): ContextHelp | null | Promise<ContextHelp | null>;
  getGutterHelp?(
    editor: TextEditor,
    bufferRow: number,
    options?: { signal?: AbortSignal },
  ): ContextHelp | null | Promise<ContextHelp | null>;
  grammarScopes?: string[] | Set<string>;
  priority?: number;
  name?: string;
  packageName?: string;
};

type ContextHelp = {
  contents: ContextHelpContent;
  range?: Range;
};

type ContextHelpContent =
  | {
      value: string;
      kind?: "markdown" | "plaintext";
      renderCodeBlock?(block: {
        text: string;
        language: string | undefined;
        scopeName: string;
      }): HTMLElement | null | Promise<HTMLElement | null>;
    }
  | {
      render(): ContextHelpElement | null | Promise<ContextHelpElement | null>;
    };

type ContextHelpElement = HTMLElement | { element: HTMLElement; dispose(): void };
```

`getHelp()` is required. Return `null` when the source has no answer. `getGutterHelp()` is optional and is called only for gutter requests; a provider without it is skipped. `contents.value` is markdown unless `kind` is `"plaintext"`.

`grammarScopes` restricts the provider to those grammar scopes. Omit it to serve every grammar; a getter is allowed and is read on every request. Higher `priority` places the content earlier in the combined answer; its default is `0`. `name` and `packageName` identify the source for diagnostics.

`range` describes the text the answer belongs to. Return an accurate range for hover stability; an answer outside the requested position is ignored. Gutter answers can omit it to describe the whole row.

Custom content supplies a `render()` factory rather than a prebuilt element. Each invocation must create a fresh element so a tooltip and a dock panel can show the same answer independently. Return `{ element, dispose }` when your view owns subscriptions, embedded editors, or other resources. The factory may return a promise, or `null` to omit that section. Close over the answer's data, rather than performing a new request in `render()`.

`renderCodeBlock()` customizes a markdown fence. It receives the original text without the final fence newline, its language identifier, and the resolved grammar scope (`text.plain` when unknown). Return a fresh element with no resources that require disposal, or `null` for the normal embedded editor. Throwing or rejecting falls back to the normal renderer. Plain-text answers never invoke it.

## Minimal example

```js
module.exports = {
  provideContextHelp() {
    return {
      name: "Example documentation",
      packageName: "example-docs",
      grammarScopes: ["source.example"],
      getHelp(editor, position, { signal } = {}) {
        if (signal?.aborted) return null;
        return {
          contents: {
            kind: "markdown",
            value: "Use `let` to declare a variable in this language.",
          },
        };
      },
    };
  },
};
```

## Behavior

The registry collects every non-empty answer from matching providers and orders the sections by descending priority. Priority affects presentation; it does not make a provider exclusive. A failing provider is logged and does not discard other providers' answers.

Cancellation belongs to each request. Observe its `signal` and release work when it is aborted. Keep cancellation state local to the call: a later hover request must not cancel a simultaneous request for the documentation panel. The registry ignores an answer that arrives after cancellation or after the provider's registration is removed.

## Teardown

The hub's `consumeContextHelp()` callback returns a `Disposable` that removes exactly that provider registration. Rendered content is owned by the consumer view: disposing the rendering calls each custom content disposer and destroys embedded code editors. Removing a provider does not erase a snapshot already displayed in the panel.

## Versioning

Provide `1.0.0` and consume `^1.0.0`. This service replaces `hover.provider` during preproduction; use `getHelp()` and `getGutterHelp()` instead of the previous hover methods. Both sides migrate together, without compatibility aliases. Signature-help providers continue to use their separate contract.
