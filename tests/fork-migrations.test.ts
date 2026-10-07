import { describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

function withMigratedDatabase(check: (db: Database) => void): void {
	const db = new Database(':memory:');
	try {
		db.exec('PRAGMA foreign_keys = ON');
		const directory = fileURLToPath(new URL('../drizzle/', import.meta.url));
		const journal = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8'));
		for (const entry of journal.entries) {
			db.exec(readFileSync(join(directory, `${entry.tag}.sql`), 'utf8'));
		}
		check(db);
	} finally {
		db.close();
	}
}

describe('fork migration constraints', () => {
	test('tag names remain case-insensitive after regeneration', () => {
		withMigratedDatabase(db => {
			db.run('INSERT INTO tags (name) VALUES (?)', ['Prod']);
			expect(() => db.run('INSERT INTO tags (name) VALUES (?)', ['prod'])).toThrow();
			expect(db.query('SELECT name FROM tags').all()).toEqual([{ name: 'Prod' }]);
		});
	});

	test('passkey names are case-insensitive per user, credentials are global, and user deletion cascades', () => {
		withMigratedDatabase(db => {
			db.exec("INSERT INTO users (id, username, password_hash) VALUES (1, 'first', 'unused'), (2, 'second', 'unused')");
			const insert = db.query('INSERT INTO passkey_credentials (user_id, credential_id, webauthn_user_id, public_key, device_type, name) VALUES (?, ?, ?, ?, ?, ?)');
			insert.run(1, 'credential-1', 'user-1', 'key-1', 'singleDevice', 'Laptop');
			expect(() => insert.run(1, 'credential-2', 'user-1', 'key-2', 'singleDevice', 'laptop')).toThrow();
			insert.run(2, 'credential-2', 'user-2', 'key-2', 'singleDevice', 'laptop');
			expect(() => insert.run(2, 'credential-1', 'user-2', 'key-3', 'singleDevice', 'Phone')).toThrow();
			db.run('DELETE FROM users WHERE id = ?', [1]);
			expect(db.query('SELECT user_id, credential_id, name FROM passkey_credentials').all()).toEqual([
				{ user_id: 2, credential_id: 'credential-2', name: 'laptop' }
			]);
		});
	});
});
