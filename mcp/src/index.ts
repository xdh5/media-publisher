import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { listAccountsTool, handleListAccounts, configureAccountsTool, handleConfigureAccounts } from "./tools/accounts.js";
import { startPublishTool, pollTaskTool, handleStartPublish, handlePollTask } from "./tools/publish.js";
import {
  loginTool,
  loginStatusTool,
  handleLogin,
  handleLoginStatus,
  type McpContent,
} from "./tools/login.js";

const server = new Server(
  { name: "media-publisher", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      listAccountsTool,
      configureAccountsTool,
      loginTool,
      loginStatusTool,
      startPublishTool,
      pollTaskTool,
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args: Record<string, unknown> = request.params.arguments ?? {};
  try {
    let content: McpContent[];
    switch (name) {
      case "configure_accounts":
        content = [{ type: "text", text: await handleConfigureAccounts(args) }];
        break;
      case "list_accounts":
        content = [{ type: "text", text: await handleListAccounts(args) }];
        break;
      case "login":
        content = await handleLogin(args);
        break;
      case "login_status":
        content = await handleLoginStatus(args);
        break;
      case "start_publish":
        content = [{ type: "text", text: await handleStartPublish(args) }];
        break;
      case "poll_task":
        content = [{ type: "text", text: handlePollTask(args) }];
        break;
      default:
        throw new Error("Unknown tool: " + name);
    }
    return { content };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
