# documentation-view

Read documentation and contextual help in a persistent dock panel.

Request help at the cursor or open an existing hover answer in the panel. The panel keeps that answer while you move the cursor, switch files, or dismiss the tooltip. Providers supply the same content to both surfaces through the context-help services.

## Features

- **On-demand help**: reads documentation, types, and diagnostics at the source cursor.
- **Persistent panel**: keeps the last answer in a dock until you refresh or clear it.
- **Hover handoff**: opens the exact answer displayed by a hover tooltip without requesting it again.
- **Source context**: identifies the file and buffer position the answer describes.
- **Combined providers**: shows every matching provider's content in priority order.
- **Independent rendering**: renders markdown, plain text, and interactive provider content separately for each surface.

## Installation

To install `documentation-view` search for it in the Install pane of the Lumine settings, or run the command `lumine --install lumine-code/documentation-view`.

## Commands

Commands available in `lumine-workspace`:

- `documentation-view:open`: request help at the source cursor and reveal the panel while keeping focus in the editor,
- `documentation-view:toggle`: show or hide the panel,
- `documentation-view:toggle-focus`: focus the panel or return focus to the editor.

Commands available in `.documentation-view`:

- `documentation-view:refresh`: request help again at the displayed source position,
- `documentation-view:clear`: remove the displayed answer,
- `documentation-view:return-to-editor`: return focus to the active editor.

## Usage

Install a provider for the languages or information you need. A language-server setup supplies documentation through `ide`; `linter` can supply diagnostics. The panel works without `hover`, and `hover` uses the same registry when it is installed. Signature help remains a separate feature of `hover`.

Run `documentation-view:open` from an editor, or choose **Open in Documentation View** in a hover tooltip. Opening an existing tooltip keeps its original source position, which can differ from the cursor position. Refresh asks about that saved position, clamped to the current buffer if the source has changed; it does not follow later cursor movement or the active file. The header indicates when the source has changed or closed. Returning to the editor focuses the currently active editor.

## Customization

Add a rule to your `styles.css` to adjust the panel:

```css
.documentation-view {
  font-size: 14px;
  color: var(--text-color);
}
```

## Services

- [`context-help.provider`](docs/context-help.provider.md): consumed to collect contextual help from providers.
- [`context-help.registry`](docs/context-help.registry.md): provided to request and render combined answers for consumer views.
- [`context-help.panel`](docs/context-help.panel.md): provided to display an existing answer in the dock panel.
- `background-tips.provider`: provided to teach how to request help in the panel.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
