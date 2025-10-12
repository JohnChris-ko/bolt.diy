import { atom, type WritableAtom } from 'nanostores';
import type { ITerminal } from '~/types/terminal';
import { coloredText } from '~/utils/terminal';
import { dockerRuntime } from '~/lib/runtime/docker-runtime';

export class TerminalStore {
  #sessionId: string;
  #websockets: Map<ITerminal, WebSocket> = new Map();

  showTerminal: WritableAtom<boolean> = import.meta.hot?.data.showTerminal ?? atom(true);

  constructor(sessionId: string) {
    this.#sessionId = sessionId;

    if (import.meta.hot) {
      import.meta.hot.data.showTerminal = this.showTerminal;
    }
  }

  toggleTerminal(value?: boolean) {
    this.showTerminal.set(value !== undefined ? value : !this.showTerminal.get());
  }

  async attachBoltTerminal(terminal: ITerminal) {
    try {
      const ws = dockerRuntime.createTerminalWebSocket(this.#sessionId);

      ws.onopen = () => {
        terminal.write(coloredText.green('Terminal connected\n\n'));
        // Send resize if terminal has dimensions
        if (terminal.cols && terminal.rows) {
          ws.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'output') {
            terminal.write(message.data);
          } else if (message.type === 'error') {
            terminal.write(coloredText.red(`Error: ${message.data}\n`));
          }
        } catch (error) {
          console.error('Failed to parse terminal message:', error);
        }
      };

      ws.onclose = () => {
        terminal.write(coloredText.yellow('\n\nTerminal disconnected\n'));
      };

      ws.onerror = (error) => {
        terminal.write(coloredText.red('Terminal connection error\n'));
        console.error('Terminal WebSocket error:', error);
      };

      // Listen to terminal input
      terminal.onData((data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }));
        }
      });

      this.#websockets.set(terminal, ws);
    } catch (error: any) {
      terminal.write(coloredText.red('Failed to connect terminal\n\n') + error.message);
      return;
    }
  }

  async attachTerminal(terminal: ITerminal) {
    // Same implementation as attachBoltTerminal
    await this.attachBoltTerminal(terminal);
  }

  onTerminalResize(cols: number, rows: number) {
    for (const { process } of this.#terminals) {
      process.resize({ cols, rows });
    }
  }

  async detachTerminal(terminal: ITerminal) {
    const terminalIndex = this.#terminals.findIndex((t) => t.terminal === terminal);

    if (terminalIndex !== -1) {
      const { process } = this.#terminals[terminalIndex];

      try {
        process.kill();
      } catch (error) {
        console.warn('Failed to kill terminal process:', error);
      }
      this.#terminals.splice(terminalIndex, 1);
    }
  }
}
