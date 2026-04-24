
***

**System Role:** You are an expert VS Code Extension Developer and AI Systems Architect. Your task is to build a complex, local-first context engine extension for VS Code designed to empower the Claude Code AI CLI. 

**Project Overview:**
The goal is to replicate and improve upon the semantic, graph-driven context capabilities seen in tools like `vexp.dev`. The extension will parse the codebase into a dependency graph, visualize it, and feed highly relevant, token-optimized context to Claude Code and its sub-agents using the Model Context Protocol (MCP).

**Core Technical Requirements & Architecture:**

**1. AST Indexing & Semantic Graph (The Backend)**
*   Implement a local parsing engine using Tree-sitter to traverse the workspace's Abstract Syntax Trees (AST).
*   Store the extracted structural relationships (functions, classes, imports) in an embedded local SQLite database to create a directed dependency graph.
*   Ensure the indexing runs asynchronously (e.g., via a Web Worker) so it doesn't block the VS Code extension host.

**2. MCP Server Implementation**
*   Build the MCP server using the official `@modelcontextprotocol/sdk` for TypeScript.[1]
*   Register the MCP server directly within VS Code using the `vscode.lm.registerMcpServerDefinitionProvider` API.[2]
*   Expose tools to Claude Code using the required MCP tool name format: `mcp__{server_name}__{tool_name}` (e.g., `mcp__graph__get_dependency_chain`).[3]
*   Implement Agent Identity Protocol (AIP) logic to inspect incoming `agent_id` metadata. This ensures that when specialized sub-agents query the graph, the server filters the returned nodes based on the agent's specific domain (e.g., UI vs. Database).[4]

**3. Interactive Webview Visualization**
*   Create a rich visualization of the SQLite dependency graph using the VS Code Webview API.[5]
*   Render the network using Cytoscape.js integrated with React to handle force-directed layouts for potentially thousands of nodes.[6, 7]
*   Implement bi-directional message passing: clicking a node in the Webview should query the SQLite DB, and when the MCP server serves context to Claude, the Webview should highlight those specific nodes to show the user the AI's "cognitive boundaries."

**4. Terminal Interception & Shell Integration**
*   Leverage VS Code's Terminal Shell Integration APIs, specifically listening to `window.onDidStartTerminalShellExecution` and parsing the `TerminalShellExecutionStartEvent` stream.[8]
*   If Claude Code executes a command (like a test runner) that results in a stack trace, intercept this output, identify the failing functions, and auto-focus the Webview graph on the broken nodes.

**5. Claude Code Lifecycle Hooks & Memory**
*   Programmatically generate and manage Claude Code lifecycle hooks within `.claude/settings.json`. 
*   Implement a `PreToolUse` hook script that intercepts `Edit` or `Write` commands. If the AI attempts a structurally dangerous edit, the script must exit with code `2` to deterministically block the action and feed a warning back to Claude.[9, 10]
*   Implement a `PostToolUse` hook that triggers the Tree-sitter parser to instantly re-index modified files.[11]
*   Manage persistent memory for sub-agents. Instead of relying purely on unstructured text, bind the agent's analytical conclusions to specific AST nodes, and ensure the extension maps these insights to the correct sub-agent memory directories (e.g., `.claude/agent-memory/<name>/` for project scope).[12]

**First Step:** Please begin by scaffolding the VS Code extension project structure, setting up the necessary Tree-sitter and SQLite dependencies, and drafting the `vscode.lm.registerMcpServerDefinitionProvider` registration.