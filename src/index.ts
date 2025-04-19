#!/usr/bin/env node

// ** VERIFY THIS IMPORT PATH AFTER UPDATING SDK to v1.10.1 **
// Check node_modules/@modelcontextprotocol/sdk/server/* for the correct file/path
// Update this line if it's different:
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js';
// ** END VERIFICATION NEEDED **

import express from 'express';
// Original imports remain the same
import { NEON_HANDLERS, NEON_TOOLS, ToolHandler } from './tools.js';
import { NEON_RESOURCES } from './resources.js';
import { handleInit, parseArgs } from './initConfig.js';
import { createApiClient } from '@neondatabase/api-client';
import './polyfills.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
);

const commands = ['init', 'start'] as const;
const { command, neonApiKey, executablePath } = parseArgs();
if (!commands.includes(command as (typeof commands)[number])) {
  console.error(`Invalid command: ${command}`);
  process.exit(1);
}

if (command === 'init') {
  await handleInit({
    executablePath,
    neonApiKey,
  });
  process.exit(0);
}

// "start" command from here
// ----------------------------

if (!neonApiKey) {
  console.error(
    'Error: Neon API key is required for the "start" command. Provide it via --neon-api-key or NEON_API_KEY environment variable.',
  );
  process.exit(1);
}

export const neonClient = createApiClient({
  apiKey: neonApiKey,
  headers: {
    'User-Agent': `mcp-server-neon/${packageJson.version}`,
  },
});

// --- McpServer initialization remains the same ---
const server = new McpServer(
  {
    name: 'mcp-server-neon',
    // Use version from updated package.json if desired, or keep original logic
    version: packageJson.version,
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  },
);

// --- Tool registration remains the same ---
NEON_TOOLS.forEach((tool) => {
  const handler = NEON_HANDLERS[tool.name];
  if (!handler) {
    throw new Error(`Handler for tool ${tool.name} not found`);
  }
  server.tool(
    tool.name,
    tool.description,
    { params: tool.inputSchema },
    handler as ToolHandler<typeof tool.name>,
  );
});

// --- Resource registration remains the same ---
NEON_RESOURCES.forEach((resource) => {
  server.resource(
    resource.name,
    resource.uri,
    {
      description: resource.description,
      mimeType: resource.mimeType,
    },
    resource.handler,
  );
});

// --- Server Startup using Express and Streamable HTTP Transport ---
const app = express();
app.use(express.json());
const port = parseInt(process.env.PORT || '3000', 10);
const host = '0.0.0.0';

app.all('/mcp', async (req, res) => {
  console.log(`Received MCP request: ${req.method} ${req.path}`);
  try {
    // ** VERIFY **: Ensure constructor and options are correct for v1.10.1
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // For stateless operation per request
      req,
      res,
    });
    // Connect the main McpServer instance to this request-specific transport
    await server.connect(transport);
    // Let the transport handle the incoming request based on MCP specification
    await transport.handleRequest(req, res);

    console.log(`Finished handling MCP request: ${req.method} ${req.path}`);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

app.get('/', (req, res) => {
  res.status(200).send(
    `MCP Server Neon v${packageJson.version} is running. MCP endpoint is at /mcp`,
  );
});

// Start the Express server and listen
app
  .listen(port, host, () => {
    console.log(
      `MCP Server Neon listening at http://${host}:${port}`,
    );
    console.log(`MCP requests should be sent to http://${host}:${port}/mcp`);
  })
  .on('error', (error) => {
    console.error('Failed to start Express server:', error);
    process.exit(1);
  });
