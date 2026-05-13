import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
/**
 * Idempotent Postgres migration runner.
 *
 * Reads .sql files from migrations/postgres/, sorted lexicographically.
 * Tracks applied versions in persona_migrations so re-runs are safe.
 * Each file is wrapped in a transaction and CREATE TABLE statements
 * use IF NOT EXISTS, so partial replays do not corrupt the schema.
 *
 * Usage: DATABASE_URL=postgres://... node dist/migrations/run.js
 */
function migrationsDir() {
    // The runner compiles to dist/migrations/run.js; SQL files live in
    // <repo>/migrations/postgres relative to the package root. Walk up
    // from the compiled location until we find the directory.
    const here = dirname(fileURLToPath(import.meta.url));
    let dir = here;
    for (let i = 0; i < 8; i++) {
        const candidate = join(dir, 'migrations', 'postgres');
        if (existsSync(candidate))
            return candidate;
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    throw new Error(`Could not locate migrations/postgres directory starting from ${here}`);
}
export async function runMigrations(databaseUrl) {
    const dir = migrationsDir();
    const files = readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
    if (files.length === 0) {
        console.error(`No .sql files in ${dir}`);
        return 0;
    }
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`
    CREATE TABLE IF NOT EXISTS persona_migrations (
      version    text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
    const applied = new Set((await pool.query('SELECT version FROM persona_migrations')).rows.map((r) => r.version));
    let count = 0;
    try {
        for (const file of files) {
            const version = file.replace(/\.sql$/, '');
            if (applied.has(version)) {
                console.error(`skip ${version} (already applied)`);
                continue;
            }
            const sql = readFileSync(join(dir, file), 'utf-8');
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query('INSERT INTO persona_migrations (version) VALUES ($1)', [version]);
                await client.query('COMMIT');
                console.error(`applied ${version}`);
                count++;
            }
            catch (err) {
                await client.query('ROLLBACK');
                console.error(`failed ${version}:`, err);
                throw err;
            }
            finally {
                client.release();
            }
        }
    }
    finally {
        await pool.end();
    }
    console.error(`Done. ${count} migration(s) applied.`);
    return count;
}
// CLI entry point — only runs when this file is executed directly,
// not when imported by the smoke test.
const isMain = import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1] ?? '');
if (isMain) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('DATABASE_URL is required');
        process.exit(2);
    }
    runMigrations(databaseUrl).catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=run.js.map