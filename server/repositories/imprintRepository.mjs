import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';

function normalizeImprint(item) {
    return {
        id: String(item.id),
        url: item.image_url ?? item.url ?? '',
        prompt: item.prompt || '',
        deviceId: item.device_id ?? item.deviceId ?? null,
        timestamp: Number(item.timestamp || Date.now())
    };
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
            timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_imprint_items_device_timestamp
            ON imprint_items (device_id, timestamp DESC);
    `);

    const insertItem = db.prepare(`
        INSERT OR REPLACE INTO imprint_items (
            id, image_url, prompt, device_id, timestamp
        ) VALUES (
            ?, ?, ?, ?, ?
        )
    `);

    function trimItems(deviceId) {
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
        list(deviceId) {
            return db.prepare(`
                SELECT
                    id,
                    image_url AS url,
                    prompt,
                    device_id AS deviceId,
                    timestamp
                FROM imprint_items
                WHERE device_id IS ?
                ORDER BY timestamp DESC, id DESC
                LIMIT ?
            `).all(deviceId, maxItems).map(normalizeImprint);
        },

        add(item) {
            const normalized = normalizeImprint(item);
            insertItem.run(
                normalized.id,
                normalized.url,
                normalized.prompt,
                normalized.deviceId,
                normalized.timestamp
            );
            trimItems(normalized.deviceId);
            return normalized;
        },

        deleteById(id, deviceId) {
            const result = db.prepare(`
                DELETE FROM imprint_items
                WHERE id = ? AND device_id IS ?
            `).run(String(id), deviceId);

            return result.changes > 0;
        }
    };
}
