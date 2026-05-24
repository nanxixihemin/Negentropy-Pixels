import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';

function normalizeGalleryItem(item) {
    return {
        id: String(item.id),
        filename: item.filename,
        prompt: item.prompt || '',
        author: item.author || null,
        deviceId: item.device_id ?? item.deviceId ?? null,
        caption: item.caption || null,
        timestamp: Number(item.timestamp || Date.now())
    };
}

export function createGalleryRepository({ dataDir, dbPath, legacyMetaPath, maxItems = 100 }) {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const db = new DatabaseSync(dbPath);
    db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS gallery_items (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            prompt TEXT NOT NULL DEFAULT '',
            author TEXT,
            device_id TEXT,
            caption TEXT,
            timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_gallery_items_timestamp
            ON gallery_items (timestamp DESC);
    `);

    const insertItem = db.prepare(`
        INSERT OR IGNORE INTO gallery_items (
            id, filename, prompt, author, device_id, caption, timestamp
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?
        )
    `);

    function importLegacyJson() {
        if (!legacyMetaPath || !fs.existsSync(legacyMetaPath)) return;

        let items = [];
        try {
            items = JSON.parse(fs.readFileSync(legacyMetaPath, 'utf-8'));
        } catch (err) {
            console.warn('[GalleryDB] Legacy gallery.json import skipped:', err.message);
            return;
        }

        if (!Array.isArray(items)) return;

        db.exec('BEGIN');
        try {
            for (const item of items) {
                if (!item?.id || !item?.filename) continue;
                const normalized = normalizeGalleryItem(item);
                insertItem.run(
                    normalized.id,
                    normalized.filename,
                    normalized.prompt,
                    normalized.author,
                    normalized.deviceId,
                    normalized.caption,
                    normalized.timestamp
                );
            }
            db.exec('COMMIT');
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    }

    function trimItems() {
        db.prepare(`
            DELETE FROM gallery_items
            WHERE id IN (
                SELECT id FROM gallery_items
                ORDER BY timestamp DESC, id DESC
                LIMIT -1 OFFSET ?
            )
        `).run(maxItems);
    }

    function listItems() {
        return db.prepare(`
            SELECT
                id,
                filename,
                prompt,
                author,
                device_id AS deviceId,
                caption,
                timestamp
            FROM gallery_items
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
        `).all(maxItems).map(normalizeGalleryItem);
    }

    function syncLegacyJson() {
        if (!legacyMetaPath) return;
        fs.writeFileSync(legacyMetaPath, JSON.stringify(listItems(), null, 2));
    }

    importLegacyJson();
    trimItems();

    return {
        list() {
            return listItems();
        },

        add(item) {
            const normalized = normalizeGalleryItem(item);
            insertItem.run(
                normalized.id,
                normalized.filename,
                normalized.prompt,
                normalized.author,
                normalized.deviceId,
                normalized.caption,
                normalized.timestamp
            );
            trimItems();
            syncLegacyJson();
            return normalized;
        },

        findById(id) {
            const item = db.prepare(`
                SELECT
                    id,
                    filename,
                    prompt,
                    author,
                    device_id AS deviceId,
                    caption,
                    timestamp
                FROM gallery_items
                WHERE id = ?
            `).get(String(id));

            return item ? normalizeGalleryItem(item) : null;
        },

        deleteById(id) {
            const result = db.prepare('DELETE FROM gallery_items WHERE id = ?').run(String(id));
            if (result.changes > 0) {
                syncLegacyJson();
            }
            return result.changes > 0;
        }
    };
}
