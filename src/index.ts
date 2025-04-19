#!/usr/bin/env node

// ** REMOVED ** Stdio transport import
// import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

// ** ADDED ** Imports for Express and HTTP transport
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'; // Verify this path from SDK source if needed

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

// Ensure API key is provided for the 'start' command
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

// --- ** MODIFIED ** Server Startup using Express and Streamable HTTP Transport ---

// Create an Express application
const app = express();

// Middleware to parse JSON bodies (important for POST requests)
app.use(express.json());

// Define the port using environment variable (for Render) or default
const port = parseInt(process.env.PORT || '3000', 10);
// Define the host required by Render
const host = '0.0.0.0';

// Handle all MCP requests (GET, POST, DELETE) at a single endpoint (e.g., /mcp)
// You can change '/mcp' if desired, but keep it consistent.
app.all('/mcp', async (req, res) => {
  console.log(`Received MCP request: ${req.method} ${req.path}`);
  try {
    // Instantiate the transport for each request (stateless approach from example)
    // It uses the incoming request (req) and response (res) objects.
    // Setting sessionIdGenerator to undefined makes it stateless per request.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
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
    // Avoid sending response if headers already sent (e.g., by transport error handling)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// Add a simple root endpoint for health checks or basic info
app.get('/', (req, res) => {
  res.status(200).send(
    `MCP Server Neon v${packageJson.version} is running. MCP endpoint is at /mcp`,
  );
});

// Start the Express server
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

// --- ** REMOVED ** Old stdio main function ---
// async function main() {
//   const transport = new StdioServerTransport();
//   await server.connect(transport);
// }
// main().catch((error: unknown) => {
//   console.error('Server error:', error);
//   process.exit(1);
// });
