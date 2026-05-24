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

    // Dynamically migrate table to support password recovery columns if they don't exist
    try {
        db.exec(`
            ALTER TABLE users ADD COLUMN security_question TEXT;
            ALTER TABLE users ADD COLUMN security_answer TEXT;
        `);
    } catch (e) {
        // Ignored: columns might already exist
    }

    function countUsers() {
        return db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
    }

    function getUserByUsername(username) {
        return db.prepare(`
            SELECT id, username, nickname, password_hash, role, created_at, security_question, security_answer
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
        register({ username, password, nickname, securityQuestion, securityAnswer }) {
            const cleanUsername = String(username || '').trim();
            const cleanNickname = String(nickname || '').trim();
            
            // Validate email format
            if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(cleanUsername)) {
                throw new Error('请输入有效的邮箱地址（格式如: example@domain.com）');
            }
            if (String(password || '').length < 6) {
                throw new Error('密码至少需要 6 位');
            }
            if (!securityQuestion || !String(securityAnswer || '').trim()) {
                throw new Error('请选择安全问题并填写密保答案，用于日后找回密码');
            }
            if (getUserByUsername(cleanUsername)) {
                throw new Error('该邮箱地址已被注册');
            }

            const now = Date.now();
            const user = {
                id: crypto.randomUUID(),
                username: cleanUsername,
                nickname: cleanNickname || cleanUsername,
                passwordHash: hashPassword(password),
                role: countUsers() === 0 ? 'admin' : 'user',
                createdAt: now,
                securityQuestion,
                securityAnswer: String(securityAnswer || '').trim().toLowerCase()
            };

            db.prepare(`
                INSERT INTO users (id, username, nickname, password_hash, role, created_at, security_question, security_answer)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                user.id, 
                user.username, 
                user.nickname, 
                user.passwordHash, 
                user.role, 
                user.createdAt, 
                user.securityQuestion, 
                user.securityAnswer
            );

            const session = createSession(user.id);
            return { user: normalizeUser(user), ...session };
        },

        login({ username, password }) {
            const user = getUserByUsername(String(username || '').trim());
            if (!user || !verifyPassword(password, user.password_hash)) {
                throw new Error('邮箱或密码错误');
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
        },

        resetPassword({ username, securityQuestion, securityAnswer, newPassword }) {
            const cleanUsername = String(username || '').trim();
            const cleanAnswer = String(securityAnswer || '').trim().toLowerCase();
            const user = getUserByUsername(cleanUsername);

            if (!user) {
                throw new Error('该邮箱地址未注册');
            }
            if (!user.security_question) {
                throw new Error('该账号在升级前注册，未配置密保问题。请联系管理员手动找回。');
            }
            if (user.security_question !== securityQuestion) {
                throw new Error('密保问题不匹配，重置失败');
            }
            if (user.security_answer !== cleanAnswer) {
                throw new Error('密保答案错误，重置失败');
            }
            if (String(newPassword || '').length < 6) {
                throw new Error('新密码至少需要 6 位');
            }

            const newHash = hashPassword(newPassword);
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, user.id);

            // Invalidate all existing sessions for security
            db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(user.id);

            return { success: true };
        }
    };
}
