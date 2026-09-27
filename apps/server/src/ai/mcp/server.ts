import readline from 'node:readline';

/**
 * MCP (Model Context Protocol) server over stdio — JSON-RPC 2.0.
 *
 * Exposes the platform's agent tools to any MCP client (e.g. Claude
 * Desktop). Run with `pnpm mcp`. The platform's own agent calls the same
 * tool functions in-process, so MCP adds an integration surface without
 * being a runtime dependency of the app.
 */

interface RpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonSchemaType {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

async function main(): Promise<void> {
  // Imported lazily so `pnpm mcp` doesn't boot the whole server env check.
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'development';
  const { TOOL_REGISTRY } = await import('../../agents/tools.js');

  const send = (msg: unknown): void => {
    process.stdout.write(JSON.stringify(msg) + '\n');
  };

  const respond = (id: RpcRequest['id'], result: unknown): void =>
    send({ jsonrpc: '2.0', id, result });

  const respondError = (id: RpcRequest['id'], code: number, message: string): void =>
    send({ jsonrpc: '2.0', id, error: { code, message } });

  const rl = readline.createInterface({ input: process.stdin, terminal: false });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let req: RpcRequest;
    try {
      req = JSON.parse(trimmed) as RpcRequest;
    } catch {
      respondError(null, -32700, 'Parse error');
      return;
    }

    switch (req.method) {
      case 'initialize':
        respond(req.id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'career-intelligence-tools', version: '0.1.0' },
        });
        return;
      case 'notifications/initialized':
        return; // no response for notifications
      case 'tools/list':
        respond(req.id, {
          tools: TOOL_REGISTRY.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters,
          })),
        });
        return;
      case 'tools/call': {
        const params = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        const tool = TOOL_REGISTRY.find((t) => t.name === params.name);
        if (tool === undefined) {
          respondError(req.id, -32602, `Unknown tool: ${String(params.name)}`);
          return;
        }
        tool
          .execute(params.arguments ?? {})
          .then((result) => {
            const text = typeof result === 'string' ? result : JSON.stringify(result);
            respond(req.id, {
              content: [{ type: 'text', text }],
            });
          })
          .catch((err: unknown) => {
            respondError(req.id, -32000, String(err));
          });
        return;
      }
      default:
        if (req.id !== undefined && req.id !== null) {
          respondError(req.id, -32601, `Method not found: ${req.method}`);
        }
    }
  });

  // Keepalive so the transport stays open.
  setInterval(() => {}, 1 << 30);
}

void main();
