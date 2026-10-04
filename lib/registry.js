const { Disposable, Point, Range } = require("lumine");

// One registry serves both the transient tooltip and the retained panel.
// Requests own their cancellation; one reader never cancels another reader.
module.exports = class ContextHelpRegistry {
  constructor() {
    this.providers = [];
    this.requests = new Set();
    this.disposed = false;
  }

  addProvider(provider) {
    if (typeof provider?.getHelp !== "function") {
      throw new TypeError("A context-help provider must define getHelp().");
    }
    const registration = { provider };
    this.providers.push(registration);
    return new Disposable(() => {
      const index = this.providers.indexOf(registration);
      if (index !== -1) this.providers.splice(index, 1);
    });
  }

  async request(editor, position, { gutter = false, signal } = {}) {
    if (this.disposed || signal?.aborted || editor.isDestroyed()) return null;
    const point = Point.fromObject(position).copy();
    const controller = new AbortController();
    const cancelled = new Promise((resolve) => {
      controller.signal.addEventListener("abort", () => resolve(null), { once: true });
    });
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const subscriptions = [editor.onDidDestroy(abort), editor.getBuffer().onDidChangeText(abort)];
    this.requests.add(controller);
    try {
      const scopeName = editor.getGrammar()?.scopeName;
      const providers = this.providers
        .filter(({ provider }) => {
          try {
            const scopes = provider.grammarScopes;
            return !scopes || Array.from(scopes).includes(scopeName);
          } catch (error) {
            console.error(error);
            return false;
          }
        })
        .sort((a, b) => (b.provider.priority ?? 0) - (a.provider.priority ?? 0));
      const answers = [];
      for (const registration of providers) {
        const { provider } = registration;
        if (controller.signal.aborted) return null;
        if (!this.providers.includes(registration)) continue;
        let answer;
        try {
          const pending = gutter
            ? provider.getGutterHelp?.(editor, point.row, { signal: controller.signal })
            : provider.getHelp(editor, point, { signal: controller.signal });
          answer = await Promise.race([pending, cancelled]);
          if (controller.signal.aborted) return null;
          if (!this.providers.includes(registration)) continue;
          if (!answer?.contents?.value && typeof answer?.contents?.render !== "function") continue;
          const range = answer.range ? Range.fromObject(answer.range) : null;
          if (range && !range.containsPoint(point)) continue;
          answers.push({ registration, contents: answer.contents, range });
        } catch (error) {
          if (!controller.signal.aborted) console.error(error);
          continue;
        }
      }
      if (controller.signal.aborted) return null;
      const current = answers.filter((answer) => this.providers.includes(answer.registration));
      if (current.length === 0) return null;
      const ranges = current.map((answer) => answer.range).filter(Boolean);
      const range = ranges.length
        ? ranges.reduce((a, b) => new Range(Point.max(a.start, b.start), Point.min(a.end, b.end)))
        : gutter
          ? Range.fromObject(editor.getBuffer().rangeForRow(point.row))
          : null;
      return {
        editor,
        position: point,
        gutter,
        range,
        contents: current.map((answer) => answer.contents),
      };
    } finally {
      signal?.removeEventListener("abort", abort);
      for (const subscription of subscriptions) subscription.dispose();
      this.requests.delete(controller);
    }
  }

  dispose() {
    this.disposed = true;
    for (const controller of this.requests) controller.abort();
    this.requests.clear();
    this.providers.length = 0;
  }
};
