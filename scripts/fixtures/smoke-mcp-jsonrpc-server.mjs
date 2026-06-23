import readline from 'node:readline'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

rl.on('line', (line) => {
  if (!line.trim()) return
  const request = JSON.parse(line)
  if (!('id' in request)) return

  if (request.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'smoke-mcp-jsonrpc-server', version: '0.1.0' },
      },
    })
    return
  }

  if (request.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        tools: [
          {
            name: 'smoke.echo',
            description: 'Echoes input for AgentHub MCP JSON-RPC smoke testing.',
            inputSchema: {
              type: 'object',
              properties: {
                message: { type: 'string' },
              },
              required: ['message'],
            },
          },
        ],
      },
    })
    return
  }

  if (request.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: `echo:${request.params?.arguments?.message ?? ''}`,
          },
        ],
        structuredContent: {
          echoed: request.params?.arguments ?? {},
        },
        isError: false,
      },
    })
    return
  }

  send({
    jsonrpc: '2.0',
    id: request.id,
    error: {
      code: -32601,
      message: `Unknown method: ${request.method}`,
    },
  })
})
