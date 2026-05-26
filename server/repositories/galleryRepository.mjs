import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';

function normalizeGalleryItem(item) {
    return {
        id: String(item.id),
        filename: item.filename,
        prompt: item.prompt || '',
        author: item.author || null,
        deviceId: item.device_id ?? item.deviceId ?? null,
        userId: item.user_id ?? item.userId ?? null,
        username: item.username || null,
        nickname: item.nickname || null,
        caption: item.caption || null,
        isFeatured: Boolean(item.is_featured ?? item.isFeatured ?? false),
        featuredAt: item.featured_at ?? item.featuredAt ?? null,
        timestamp: Number(item.timestamp || Date.now())
    };
}

function ensureColumn(db, table, column, definition) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!columns.some(item => item.name === column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
}

export function createGalleryRepository({ dataDir, dbPath, legacyMetaPath, maxItems = 100 }) {
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }

    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 10000;');
    db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS gallery_items (
            id TEXT PRIMARY KEY,
            filename TEXT NOT NULL,
            prompt TEXT NOT NULL DEFAULT '',
            author TEXT,
            device_id TEXT,
            user_id TEXT,
            caption TEXT,
            is_featured INTEGER NOT NULL DEFAULT 0,
            featured_at INTEGER,
            timestamp INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_gallery_items_timestamp
            ON gallery_items (timestamp DESC);
    `);
    ensureColumn(db, 'gallery_items', 'user_id', 'TEXT');
    ensureColumn(db, 'gallery_items', 'is_featured', 'INTEGER NOT NULL DEFAULT 0');
    ensureColumn(db, 'gallery_items', 'featured_at', 'INTEGER');
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_gallery_items_user_timestamp
            ON gallery_items (user_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_gallery_items_featured_timestamp
            ON gallery_items (is_featured DESC, featured_at DESC, timestamp DESC);
    `);

    const insertItem = db.prepare(`
        INSERT OR IGNORE INTO gallery_items (
            id, filename, prompt, author, device_id, user_id, caption, timestamp
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?
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
                    normalized.userId,
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
        try {
            const rows = db.prepare(`
                SELECT id FROM gallery_items
                ORDER BY timestamp DESC, id DESC
            `).all();
            if (rows.length > maxItems) {
                const idsToDelete = rows.slice(maxItems).map(r => r.id);
                const placeholders = idsToDelete.map(() => '?').join(',');
                db.prepare(`
                    DELETE FROM gallery_items
                    WHERE id IN (${placeholders})
                `).run(...idsToDelete);
            }
        } catch (e) {
            console.error('[GalleryDB] trimItems error:', e);
        }
    }

    function listItems() {
        return db.prepare(`
            SELECT
                id,
                filename,
                prompt,
                author,
                device_id AS deviceId,
                user_id AS userId,
                caption,
                is_featured AS isFeatured,
                featured_at AS featuredAt,
                timestamp
            FROM gallery_items
            ORDER BY is_featured DESC, featured_at DESC, timestamp DESC, id DESC
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

        listForUser(userId) {
            return db.prepare(`
                SELECT
                    id,
                    filename,
                    prompt,
                    author,
                    device_id AS deviceId,
                    user_id AS userId,
                    caption,
                    is_featured AS isFeatured,
                    featured_at AS featuredAt,
                    timestamp
                FROM gallery_items
                WHERE user_id IS ?
                ORDER BY timestamp DESC, id DESC
                LIMIT ?
            `).all(userId, maxItems).map(normalizeGalleryItem);
        },

        listAllForAdmin() {
            return db.prepare(`
                SELECT
                    gallery_items.id,
                    gallery_items.filename,
                    gallery_items.prompt,
                    gallery_items.author,
                    gallery_items.device_id AS deviceId,
                    gallery_items.user_id AS userId,
                    gallery_items.caption,
                    gallery_items.is_featured AS isFeatured,
                    gallery_items.featured_at AS featuredAt,
                    gallery_items.timestamp,
                    users.username,
                    users.nickname
                FROM gallery_items
                LEFT JOIN users ON users.id = gallery_items.user_id
                ORDER BY gallery_items.is_featured DESC, gallery_items.featured_at DESC, gallery_items.timestamp DESC, gallery_items.id DESC
                LIMIT ?
            `).all(maxItems).map(normalizeGalleryItem);
        },

        add(item) {
            const normalized = normalizeGalleryItem(item);
            insertItem.run(
                normalized.id,
                normalized.filename,
                normalized.prompt,
                normalized.author,
                normalized.deviceId,
                normalized.userId,
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
                    user_id AS userId,
                    caption,
                    is_featured AS isFeatured,
                    featured_at AS featuredAt,
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
        },

        setFeatured(id, featured) {
            const result = db.prepare(`
                UPDATE gallery_items
                SET is_featured = ?, featured_at = ?
                WHERE id = ?
            `).run(featured ? 1 : 0, featured ? Date.now() : null, String(id));
            if (result.changes > 0) {
                syncLegacyJson();
            }
            return this.findById(id);
        }
    };
}
