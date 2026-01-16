import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from script directory (not cwd) so it works when spawned by MCP clients
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, "..", ".env");

try {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const [key, ...valueParts] = trimmed.split("=");
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join("=").trim();
      }
    }
  }
} catch {
  // .env file doesn't exist, will check required vars below
}

// Validate required environment variables
const requiredEnvVars = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    console.error("Create a .env file with DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME");
    process.exit(1);
  }
}

// Create MySQL connection pool using environment variables from .env file
const pool = mysql.createPool({
  host: process.env.DB_HOST!,
  user: process.env.DB_USER!,
  password: process.env.DB_PASSWORD!,
  database: process.env.DB_NAME!,
  ssl: { rejectUnauthorized: process.env.ENV === "local" ? false : true },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

/**
 * Validates that a query is safe to execute (SELECT-only).
 * Uses a blacklist approach to block dangerous SQL operations.
 */
function isSafeQuery(query: string): boolean {
  const q = query.trim().toLowerCase();

  // Must start with SELECT
  if (!q.startsWith("select")) return false;

  // Block multiple statements (but allow semicolons inside quoted strings)
  // Simple check: if there's a semicolon not inside quotes, reject
  // For safety, we'll just check if there's a semicolon followed by non-whitespace
  const withoutStrings = q.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""');
  if (withoutStrings.includes(";")) return false;

  // Block SQL comments (potential injection vectors)
  if (withoutStrings.includes("--") || withoutStrings.includes("/*")) return false;

  // Block dangerous keywords - must be whole words (using word boundaries)
  // These keywords should not appear as standalone SQL commands
  const forbidden = [
    /\binsert\b/,
    /\bupdate\b(?!\s*\()/,  // Allow UPDATE() function but not UPDATE statement
    /\bdelete\b(?!\s*\()/,  // Allow DELETE() function but not DELETE statement  
    /\bdrop\b/,
    /\bcreate\b(?!\s*\()/,  // Allow CREATE() function but not CREATE statement
    /\balter\b/,
    /\btruncate\b/,
    /\breplace\b(?!\s*\()/,  // Allow REPLACE() function but not REPLACE statement
    /\bgrant\b/,
    /\brevoke\b/,
    /\bset\b(?!\s*\()/,  // Allow SET() function but not SET statement
    /\buse\b(?=\s+\w)/,  // Block USE database but allow "use" in other contexts
    /\bcommit\b/,
    /\brollback\b/,
    /\block\s+tables?\b/,
    /\bunlock\s+tables?\b/,
    /\bcall\b/,
    /\bexecute\b/,
    /\bprepare\b/,
    /\bdeallocate\b/,
    /\bload\b/,
    /\binto\s+outfile\b/,
    /\binto\s+dumpfile\b/,
  ];

  return !forbidden.some((pattern) => pattern.test(withoutStrings));
}

// Create MCP server
const server = new McpServer({
  name: "mysql-readonly",
  version: "1.0.0",
});

// Register the execute_sql tool
server.registerTool(
  "execute_sql",
  {
    description: "Executes a SELECT-only SQL query on the MySQL database. Only read operations are allowed - no INSERT, UPDATE, DELETE, or other modifying statements.",
    inputSchema: {
      query: z.string().describe("The SELECT SQL query to execute"),
    },
  },
  async ({ query }) => {
    // Validate query safety
    if (!isSafeQuery(query)) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Only SELECT queries are allowed. The query must not contain modifying statements, semicolons, or SQL comments.",
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      const [rows] = await pool.query(query);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ rows }, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown database error";
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ error: message }),
          },
        ],
        isError: true,
      };
    }
  }
);

// Start the server with stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MySQL MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
