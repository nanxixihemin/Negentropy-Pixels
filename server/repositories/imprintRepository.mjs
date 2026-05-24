import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';

function normalizeImprint(item) {
    return {
        id: String(item.id),
        url: item.image_url ?? item.url ?? '',
        prompt: item.prompt || '',
        deviceId: item.device_id ?? item.deviceId ?? null,
        userId: item.user_id ?? item.userId ?? null,
        username: item.username || null,
        nickname: item.nickname || null,
        timestamp: Number(item.timestamp || Date.now())
    };
}

function ensureColumn(db, table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(item => item.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

export function createImprintRepository({ dataDir, dbPath, maxItems = 20 }) {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const db = new DatabaseSync(dbPath);
    db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS imprint_items (
            id TEXT PRIMARY KEY,
            image_url TEXT NOT NULL,
            prompt TEXT NOT NULL DEFAULT '',
            device_id TEXT,
            user_id TEXT,
            timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_imprint_items_device_timestamp
            ON imprint_items (device_id, timestamp DESC);
    `);
    ensureColumn(db, 'imprint_items', 'user_id', 'TEXT');
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_imprint_items_user_timestamp
            ON imprint_items (user_id, timestamp DESC);
    `);

    const insertItem = db.prepare(`
        INSERT OR REPLACE INTO imprint_items (
            id, image_url, prompt, device_id, user_id, timestamp
        ) VALUES (
            ?, ?, ?, ?, ?, ?
        )
    `);

    function trimItems({ deviceId = null, userId = null }) {
        if (userId) {
            db.prepare(`
                DELETE FROM imprint_items
                WHERE user_id IS ?
                  AND id IN (
                    SELECT id FROM imprint_items
                    WHERE user_id IS ?
                    ORDER BY timestamp DESC, id DESC
                    LIMIT -1 OFFSET ?
                  )
            `).run(userId, userId, maxItems);
            return;
        }

        db.prepare(`
            DELETE FROM imprint_items
            WHERE device_id IS ?
              AND id IN (
                SELECT id FROM imprint_items
                WHERE device_id IS ?
                ORDER BY timestamp DESC, id DESC
                LIMIT -1 OFFSET ?
            )
        `).run(deviceId, deviceId, maxItems);
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
                    image_url AS url,
                    prompt,
                    device_id AS deviceId,
                    user_id AS userId,
                    timestamp
                FROM imprint_items
                WHERE ${ownerColumn} IS ?
                ORDER BY timestamp DESC, id DESC
                LIMIT ?
            `).all(ownerValue, maxItems).map(normalizeImprint);
        },

        listAllForAdmin() {
            return db.prepare(`
                SELECT
                    imprint_items.id,
                    imprint_items.image_url AS url,
                    imprint_items.prompt,
                    imprint_items.device_id AS deviceId,
                    imprint_items.user_id AS userId,
                    imprint_items.timestamp,
                    users.username,
                    users.nickname
                FROM imprint_items
                LEFT JOIN users ON users.id = imprint_items.user_id
                ORDER BY imprint_items.timestamp DESC, imprint_items.id DESC
                LIMIT ?
            `).all(maxItems).map(normalizeImprint);
        },

        add(item) {
            const normalized = normalizeImprint(item);
            insertItem.run(
                normalized.id,
                normalized.url,
                normalized.prompt,
                normalized.deviceId,
                normalized.userId,
                normalized.timestamp
            );
            trimItems({ deviceId: normalized.deviceId, userId: normalized.userId });
            return normalized;
        },

        deleteById(id, owner) {
            const userId = typeof owner === 'object' ? owner?.userId : null;
            const deviceId = typeof owner === 'object' ? owner?.deviceId : owner;
            const ownerColumn = userId ? 'user_id' : 'device_id';
            const ownerValue = userId || deviceId || null;
            const result = db.prepare(`
                DELETE FROM imprint_items
                WHERE id = ? AND ${ownerColumn} IS ?
            `).run(String(id), ownerValue);

            return result.changes > 0;
        }
    };
}
