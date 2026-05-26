import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';

function normalizeSession(item) {
    if (!item) return null;
    let messages = [];
    try {
        messages = JSON.parse(item.messages || '[]');
    } catch (e) {
        messages = [];
    }

    return {
        id: String(item.id),
        title: item.title || '无标题对话',
        messages,
        deviceId: item.device_id ?? item.deviceId ?? null,
        userId: item.user_id ?? item.userId ?? null,
        timestamp: Number(item.timestamp || Date.now())
    };
}

export function createChatRepository({ dataDir, dbPath, maxSessions = 50 }) {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 10000;');
    db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            messages TEXT NOT NULL DEFAULT '[]',
            device_id TEXT,
            user_id TEXT,
            timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_sessions_device_timestamp
            ON chat_sessions (device_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_timestamp
            ON chat_sessions (user_id, timestamp DESC);
    `);

    const insertSession = db.prepare(`
        INSERT OR REPLACE INTO chat_sessions (
            id, title, messages, device_id, user_id, timestamp
        ) VALUES (
            ?, ?, ?, ?, ?, ?
        )
    `);

    function trimSessions({ deviceId = null, userId = null }) {
        try {
            let rows;
            if (userId) {
                rows = db.prepare(`
                    SELECT id FROM chat_sessions
                    WHERE user_id IS ?
                    ORDER BY timestamp DESC, id DESC
                `).all(userId);
            } else {
                rows = db.prepare(`
                    SELECT id FROM chat_sessions
                    WHERE device_id IS ? AND user_id IS NULL
                    ORDER BY timestamp DESC, id DESC
                `).all(deviceId);
            }

            if (rows.length > maxSessions) {
                const idsToDelete = rows.slice(maxSessions).map(r => r.id);
                const placeholders = idsToDelete.map(() => '?').join(',');
                db.prepare(`
                    DELETE FROM chat_sessions
                    WHERE id IN (${placeholders})
                `).run(...idsToDelete);
            }
        } catch (e) {
            console.error('[ChatDB] trimSessions error:', e);
        }
    }

    return {
        list(owner) {
            const userId = typeof owner === 'object' ? owner?.userId : null;
            const deviceId = typeof owner === 'object' ? owner?.deviceId : owner;
            const ownerColumn = userId ? 'user_id' : 'device_id';
            const ownerValue = userId || deviceId || null;

            return db.prepare(`
                SELECT
                    id,
                    title,
                    messages,
                    device_id AS deviceId,
                    user_id AS userId,
                    timestamp
                FROM chat_sessions
                WHERE ${ownerColumn} IS ?
                ORDER BY timestamp DESC
                LIMIT ?
            `).all(ownerValue, maxSessions).map(normalizeSession);
        },

        save(session) {
            const normalized = {
                id: String(session.id),
                title: session.title || '新对话',
                messages: JSON.stringify(session.messages || []),
                deviceId: session.deviceId || null,
                userId: session.userId || null,
                timestamp: session.timestamp || Date.now()
            };

            insertSession.run(
                normalized.id,
                normalized.title,
                normalized.messages,
                normalized.deviceId,
                normalized.userId,
                normalized.timestamp
            );

            trimSessions({ deviceId: normalized.deviceId, userId: normalized.userId });
            return this.findById(normalized.id);
        },

        findById(id) {
            const item = db.prepare(`
                SELECT
                    id,
                    title,
                    messages,
                    device_id AS deviceId,
                    user_id AS userId,
                    timestamp
                FROM chat_sessions
                WHERE id = ?
            `).get(String(id));

            return item ? normalizeSession(item) : null;
        },

        deleteById(id, owner) {
            const userId = typeof owner === 'object' ? owner?.userId : null;
            const deviceId = typeof owner === 'object' ? owner?.deviceId : owner;
            const ownerColumn = userId ? 'user_id' : 'device_id';
            const ownerValue = userId || deviceId || null;

            const result = db.prepare(`
                DELETE FROM chat_sessions
                WHERE id = ? AND ${ownerColumn} IS ?
            `).run(String(id), ownerValue);

            return result.changes > 0;
        }
    };
}
