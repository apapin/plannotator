// Mock VS Code module for bun:test
// Only implements the APIs that plannotator-webview actually uses.

export interface UriHandler {
  handleUri(uri: Uri): ProviderResult<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

export interface ExtensionContext {
  subscriptions: { dispose(): void }[];
  extensionPath: string;
  environmentVariableCollection: {
    replace(variable: string, value: string): void;
    append(variable: string, value: string): void;
    prepend(variable: string, value: string): void;
    delete(variable: string): void;
  };
  globalState: {
    get<T>(key: string, defaultValue?: T): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
  };
}

export class Uri {
  scheme: string;
  authority: string;
  path: string;
  query: string;
  fragment: string;

  constructor(
    scheme: string,
    authority: string,
    path: string,
    query: string,
    fragment: string,
  ) {
    this.scheme = scheme;
    this.authority = authority;
    this.path = path;
    this.query = query;
    this.fragment = fragment;
  }

  static file(fsPath: string): Uri {
    return new Uri("file", "", fsPath, "", "");
  }

  static parse(value: string): Uri {
    const parsed = new globalThis.URL(value);
    return new Uri(
      parsed.protocol.replace(":", ""),
      parsed.host,
      parsed.pathname,
      parsed.search.replace("?", ""),
      parsed.hash.replace("#", ""),
    );
  }

  toString(): string {
    let result = `${this.scheme}://${this.authority}${this.path}`;
    if (this.query) result += `?${this.query}`;
    if (this.fragment) result += `#${this.fragment}`;
    return result;
  }
}

export const commands = {
  registerCommand(_id: string, _handler: (...args: unknown[]) => unknown) {
    return { dispose() {} };
  },
  async executeCommand(_command: string, ..._args: unknown[]) {},
};

export interface WebviewPanel {
  webview: { html: string };
  iconPath?: Uri;
  reveal(viewColumn?: number): void;
  dispose(): void;
  onDidDispose(listener: () => void): { dispose(): void };
}

export const ViewColumn = {
  One: 1,
  Two: 2,
  Three: 3,
};

export const window = {
  registerUriHandler(_handler: unknown) {
    return { dispose() {} };
  },
  async showInformationMessage(_message: string) {
    return undefined;
  },
  async showInputBox(_options?: unknown) {
    return undefined;
  },
  createOutputChannel(_name: string, _options?: unknown) {
    return { info() {}, warn() {}, error() {}, debug() {}, appendLine() {}, dispose() {} };
  },
  createWebviewPanel(
    _viewType: string,
    _title: string,
    _showOptions: number,
    _options?: { enableScripts?: boolean },
  ): WebviewPanel {
    let disposeListener: (() => void) | null = null;
    return {
      webview: { html: "" },
      reveal() {},
      dispose() {
        disposeListener?.();
      },
      onDidDispose(listener: () => void) {
        disposeListener = listener;
        return { dispose() {} };
      },
    };
  },
};

export const env = {
  async asExternalUri(uri: Uri): Promise<Uri> {
    return uri;
  },
};

export const workspace = {
  getConfiguration(_section?: string) {
    return {
      get(_key: string, defaultValue?: unknown) {
        return defaultValue;
      },
    };
  },
};

// Mock EnvironmentVariableCollection
class MockEnvironmentVariableCollection {
  private _vars = new Map<string, string>();

  replace(variable: string, value: string) {
    this._vars.set(variable, value);
  }

  append(variable: string, value: string) {
    this._vars.set(variable, (this._vars.get(variable) || "") + value);
  }

  prepend(variable: string, value: string) {
    this._vars.set(variable, value + (this._vars.get(variable) || ""));
  }

  delete(variable: string) {
    this._vars.delete(variable);
  }

  get(variable: string) {
    return this._vars.get(variable);
  }

  clear() {
    this._vars.clear();
  }

  [Symbol.iterator]() {
    return this._vars.entries();
  }
}

// Factory to create a mock ExtensionContext
export function createMockExtensionContext(
  extensionPath = "/mock/extension/path",
) {
  return {
    subscriptions: [] as { dispose: () => void }[],
    extensionPath,
    environmentVariableCollection: new MockEnvironmentVariableCollection(),
    globalState: (() => {
      const store = new Map<string, unknown>();
      return {
        get<T>(key: string, defaultValue?: T): T | undefined {
          return (store.has(key) ? store.get(key) : defaultValue) as T | undefined;
        },
        update(key: string, value: unknown): Promise<void> {
          store.set(key, value);
          return Promise.resolve();
        },
      };
    })(),
    workspaceState: { get: () => undefined, update: async () => {} },
  };
}
