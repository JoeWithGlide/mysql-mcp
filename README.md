# MySQL MCP Server

A Model Context Protocol (MCP) server that provides AI assistants with read-only access to MySQL databases. The server validates all queries to ensure only SELECT statements are executed.

## Features

- **Read-only access** - Only SELECT queries are allowed
- **Query validation** - Blocks dangerous SQL operations (INSERT, UPDATE, DELETE, DROP, etc.)
- **SSL/TLS support** - Works with cloud databases like PlanetScale
- **Secure credentials** - Database credentials stay on the server, never exposed to AI clients

## Prerequisites

- [Bun](https://bun.sh/) runtime
- MySQL database with a read-only user

## Installation

```bash
git clone <your-repo-url>
cd mysql-mcp
bun install
```

## Configuration

Create a `.env` file in the project root:

```env
DB_HOST=localhost
DB_USER=ai_readonly
DB_PASSWORD=your_password
DB_NAME=your_database
ENV=local # or staging/prod
```

### Creating a Read-Only MySQL User

For security, create a dedicated read-only user for the AI:

```sql
CREATE USER 'ai_readonly'@'%' IDENTIFIED BY 'STRONG_PASSWORD_HERE';
GRANT SELECT ON your_database.* TO 'ai_readonly'@'%';
FLUSH PRIVILEGES;
```

## Usage

### With Claude Desktop

Add to your `claude_desktop_config.json` (located at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "mysql": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/mysql-mcp/src/index.ts"]
    }
  }
}
```

### With Cursor

Add to your MCP server settings:

```json
{
  "mcpServers": {
    "mysql": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/mysql-mcp/src/index.ts"]
    }
  }
}
```

### Manual Testing

```bash
bun run start
```

## Available Tools

### `execute_sql`

Executes a SELECT-only SQL query on the MySQL database.

**Input:**
```json
{
  "query": "SELECT * FROM users LIMIT 10"
}
```

**Output:**
```json
{
  "rows": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ]
}
```

## Security

The server implements multiple layers of protection:

1. **Query validation** - Must start with `SELECT`
2. **Keyword blocking** - Blocks: `INSERT`, `UPDATE`, `DELETE`, `DROP`, `CREATE`, `ALTER`, `TRUNCATE`, `REPLACE`, `GRANT`, `REVOKE`, `COMMIT`, `ROLLBACK`, `LOCK`, `CALL`, `EXECUTE`, `PREPARE`, `LOAD`, `INTO OUTFILE`, `INTO DUMPFILE`
3. **Injection prevention** - Blocks semicolons (`;`) and SQL comments (`--`, `/*`)
4. **Database-level enforcement** - Use a MySQL user with only SELECT privileges

## License

MIT
