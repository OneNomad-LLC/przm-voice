#!/usr/bin/env node
/**
 * Persona CLI router.
 *
 * Usage:
 *   persona-mcp                                              run MCP stdio server (back-compat)
 *   persona-mcp read [--project <p>] [--files <list>]        read soul files, output markdown
 *   persona-mcp login [<server>] [--server <url>]            device-code login to Pyre Cloud
 *   persona-mcp logout                                       clear saved Pyre Cloud credentials
 *   persona-mcp help
 *
 * The CLI is additive — it wraps the same soul-file primitives the MCP
 * server uses so hook scripts can pull personality context without
 * speaking stdio JSON-RPC.
 *
 * --project <p> looks up <dataDir>/soul/<p>/X.md first, then falls back
 * to the global <dataDir>/soul/X.md. Today Persona's soul files are
 * global only — the per-project lookup is forward-compatible for when
 * project-scoped souls land. Existing MCP tools are untouched.
 */
export {};
