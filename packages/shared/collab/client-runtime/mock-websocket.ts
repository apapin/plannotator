/**
 * In-memory WebSocket mock for unit testing the CollabRoomClient.
 *
 * Implements enough of the WebSocket interface to satisfy the client runtime.
 * Exposes a `peer` handle for test code to script server-side behavior:
 *   - peer.sendFromServer(msg) — simulate a server message
 *   - peer.expectFromClient() — await next message the client sends
 *   - peer.simulateClose(code, reason) — simulate server-initiated close
 *   - peer.simulateError() — trigger onerror
 */

export interface MockWebSocketPeer {
  /** Send a message from "the server" to the client. */
  sendFromServer(message: string): void;
  /** Await the next message the client sends. Rejects after `timeoutMs`. */
  expectFromClient(timeoutMs?: number): Promise<string>;
  /** Close the socket from the server side. */
  simulateClose(code?: number, reason?: string): void;
  /** Trigger the onerror handler. */
  simulateError(): void;
  /** All messages the client has sent, in order. */
  readonly sent: string[];
  /** Whether the client has called close(). */
  readonly closedByClient: boolean;
}

interface PendingExpect {
  resolve: (msg: string) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

export class MockWebSocket implements EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  url: string;
  readyState: number = 0;
  binaryType: BinaryType = 'blob';
  bufferedAmount = 0;
  extensions = '';
  protocol = '';

  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  public readonly peer: MockWebSocketPeer;
  private readonly sentMessages: string[] = [];
  private readonly expectQueue: PendingExpect[] = [];
  private readonly bufferedSent: string[] = [];
  private isClosedByClient = false;

  constructor(url: string | URL, _protocols?: string | string[]) {
    this.url = typeof url === 'string' ? url : url.toString();

    const self = this;
    this.peer = {
      sendFromServer(message: string) {
        if (self.readyState !== OPEN) return;
        self.onmessage?.(new MessageEvent('message', { data: message }));
      },
      expectFromClient(timeoutMs = 2000): Promise<string> {
        if (self.bufferedSent.length > 0) {
          const msg = self.bufferedSent.shift()!;
          return Promise.resolve(msg);
        }
        return new Promise((resolve, reject) => {
          const timeoutHandle = setTimeout(() => {
            const idx = self.expectQueue.findIndex(p => p.resolve === resolve);
            if (idx >= 0) self.expectQueue.splice(idx, 1);
            reject(new Error(`expectFromClient timed out after ${timeoutMs}ms`));
          }, timeoutMs);
          self.expectQueue.push({ resolve, reject, timeoutHandle });
        });
      },
      simulateClose(code = 1000, reason = '') {
        if (self.readyState === CLOSED) return;
        self.readyState = CLOSED;
        self.onclose?.(new CloseEvent('close', { code, reason, wasClean: true }));
      },
      simulateError() {
        self.onerror?.(new Event('error'));
      },
      get sent() { return self.sentMessages; },
      get closedByClient() { return self.isClosedByClient; },
    };

    // Open asynchronously (like a real WebSocket)
    queueMicrotask(() => {
      if (this.readyState === 0) {
        this.readyState = OPEN;
        this.onopen?.(new Event('open'));
      }
    });
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (this.readyState !== OPEN) {
      throw new Error(`MockWebSocket.send called in state ${this.readyState}`);
    }
    const msg = typeof data === 'string' ? data : String(data);
    this.sentMessages.push(msg);

    // Satisfy a pending expectFromClient if any
    const pending = this.expectQueue.shift();
    if (pending) {
      clearTimeout(pending.timeoutHandle);
      pending.resolve(msg);
    } else {
      this.bufferedSent.push(msg);
    }
  }

  /**
   * When true, close() defers the onclose handler to a microtask instead of
   * firing it synchronously. This mirrors real browser behavior, where
   * ws.close() returns immediately and onclose fires asynchronously. Set via
   * `MockWebSocket.asyncCloseMode` to exercise code paths that assume async
   * close semantics.
   */
  static asyncCloseMode = false;

  close(code?: number, reason?: string): void {
    if (this.readyState === CLOSED) return;
    this.isClosedByClient = true;
    this.readyState = CLOSED;
    const closeEvent = new CloseEvent('close', {
      code: code ?? 1000,
      reason: reason ?? '',
      wasClean: true,
    });
    if (MockWebSocket.asyncCloseMode) {
      queueMicrotask(() => this.onclose?.(closeEvent));
    } else {
      this.onclose?.(closeEvent);
    }
  }

  // EventTarget stubs (not used by client, but required by type)
  addEventListener(): void {}
  removeEventListener(): void {}
  dispatchEvent(_ev: Event): boolean { return true; }
}
