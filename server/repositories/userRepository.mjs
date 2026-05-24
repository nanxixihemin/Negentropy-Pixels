import fs from 'fs';
import crypto from 'crypto';
import { DatabaseSync } from 'node:sqlite';

const SESSION_DAYS = 30;

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
    const [salt, storedHash] = String(passwordHash || '').split(':');
    if (!salt || !storedHash) return false;

    const candidate = crypto.scryptSync(password, salt, 64);
    const stored = Buffer.from(storedHash, 'hex');
    return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate);
}

function normalizeUser(user) {
    if (!user) return null;

    return {
        id: String(user.id),
        username: user.username,
        nickname: user.nickname || user.username,
        role: user.role || 'user',
        createdAt: Number(user.created_at || user.createdAt || Date.now())
    };
}

export function createUserRepository({ dataDir, dbPath }) {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const db = new DatabaseSync(dbPath);
    db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            nickname TEXT,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'user',
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_sessions (
            token_hash TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id
            ON user_sessions (user_id);
    `);

    function countUsers() {
        return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    }

    function getUserByUsername(username) {
        return db.prepare(`
            SELECT id, username, nickname, password_hash, role, created_at
            FROM users
            WHERE username = ?
        `).get(username);
    }

    function createSession(userId) {
        const token = crypto.randomBytes(32).toString('hex');
        const now = Date.now();
        const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
        db.prepare(`
            INSERT INTO user_sessions (token_hash, user_id, expires_at, created_at)
            VALUES (?, ?, ?, ?)
        `).run(hashToken(token), userId, expiresAt, now);

        return { token, expiresAt };
    }

    return {
        register({ username, password, nickname }) {
            const cleanUsername = String(username || '').trim();
            const cleanNickname = String(nickname || '').trim();
            if (!/^[a-zA-Z0-9_]{3,24}$/.test(cleanUsername)) {
                throw new Error('用户名只能包含 3-24 位字母、数字或下划线');
            }
            if (String(password || '').length < 6) {
                throw new Error('密码至少需要 6 位');
            }
            if (getUserByUsername(cleanUsername)) {
                throw new Error('用户名已存在');
            }

            const now = Date.now();
            const user = {
                id: crypto.randomUUID(),
                username: cleanUsername,
                nickname: cleanNickname || cleanUsername,
                passwordHash: hashPassword(password),
                role: countUsers() === 0 ? 'admin' : 'user',
                createdAt: now
            };

            db.prepare(`
                INSERT INTO users (id, username, nickname, password_hash, role, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(user.id, user.username, user.nickname, user.passwordHash, user.role, user.createdAt);

            const session = createSession(user.id);
            return { user: normalizeUser(user), ...session };
        },

        login({ username, password }) {
            const user = getUserByUsername(String(username || '').trim());
            if (!user || !verifyPassword(password, user.password_hash)) {
                throw new Error('用户名或密码错误');
            }

            const session = createSession(user.id);
            return { user: normalizeUser(user), ...session };
        },

        getUserByToken(token) {
            if (!token) return null;

            const row = db.prepare(`
                SELECT
                    users.id,
                    users.username,
                    users.nickname,
                    users.role,
                    users.created_at,
                    user_sessions.expires_at
                FROM user_sessions
                JOIN users ON users.id = user_sessions.user_id
                WHERE user_sessions.token_hash = ?
            `).get(hashToken(token));

            if (!row || row.expires_at < Date.now()) {
                if (row) this.logout(token);
                return null;
            }

            return normalizeUser(row);
        },

        logout(token) {
            if (!token) return false;
            const result = db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(hashToken(token));
            return result.changes > 0;
        }
    };
}
