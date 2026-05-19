#!/usr/bin/env node
/**
 * przm Voice CLI router.
 *
 * Usage:
 *   przm-voice-mcp                                              run MCP stdio server (back-compat)
 *   przm-voice-mcp read [--project <p>] [--files <list>]        read soul files, output markdown
 *   przm-voice-mcp login [<server>] [--server <url>]            device-code login to przm Cloud
 *   przm-voice-mcp logout                                       clear saved przm Cloud credentials
 *   przm-voice-mcp help
 *
 * The CLI is additive — it wraps the same soul-file primitives the MCP
 * server uses so hook scripts can pull personality context without
 * speaking stdio JSON-RPC.
 *
 * --project <p> looks up <dataDir>/soul/<p>/X.md first, then falls back
 * to the global <dataDir>/soul/X.md. Today przm Voice's soul files are
 * global only — the per-project lookup is forward-compatible for when
 * project-scoped souls land. Existing MCP tools are untouched.
 */
export {};
