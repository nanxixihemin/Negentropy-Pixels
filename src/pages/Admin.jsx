import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../App.css'

const AUTH_STORAGE_KEY = 'negentropy_auth_token'

function Admin() {
  const navigate = useNavigate()
  const [token] = useState(() => localStorage.getItem(AUTH_STORAGE_KEY) || '')
  const [gallery, setGallery] = useState([])
  const [imprints, setImprints] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState(null)

  const loadImages = useCallback(async () => {
    if (!token) {
      setError('需要管理员登录')
      setLoading(false)
      return
    }

    try {
      setError('')
      const res = await fetch('/api/admin/images', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '加载失败')
      setGallery(data.gallery || [])
      setImprints(data.imprints || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadImages()
  }, [loadImages])

  const toggleFeatured = async (e, item) => {
    e.stopPropagation()
    try {
      setError('')
      const res = await fetch(`/api/admin/gallery/${item.id}/featured`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ featured: !item.isFeatured })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '更新波源失败')
      setGallery(current => current.map(entry => (
        entry.id === item.id ? { ...entry, ...data.item } : entry
      )))
    } catch (e) {
      setError(e.message)
    }
  }

  const deleteGalleryItem = async (e, item) => {
    e.stopPropagation()
    if (!confirm('确定删除这张共享图片吗？')) return

    try {
      setError('')
      const res = await fetch(`/api/admin/gallery/${item.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '删除失败')
      setGallery(current => current.filter(entry => entry.id !== item.id))
    } catch (e) {
      setError(e.message)
    }
  }

  const renderOwner = (item) => item.nickname || item.username || item.deviceId || '匿名'

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-top-row">
          <h1 className="art-title">Image Management</h1>
          <button className="settings-btn" onClick={() => navigate('/')}>返回</button>
        </div>
      </header>

      <main className="main-content">
        {loading && <div className="loading-text">加载中...</div>}
        {error && <div className="error-message">{error}</div>}

        {!loading && !error && (
          <>
            <section className="plaza-section">
              <h3>共享画廊</h3>
              <div className="plaza-grid">
                {gallery.map(item => (
                  <div key={`gallery-${item.id}`} className="plaza-item" onClick={() => setSelectedItem(item)} style={{ cursor: 'pointer' }}>
                    <img src={`/uploads/${item.filename}`} alt={item.prompt} className="plaza-thumbnail" />
                    {item.isFeatured && <div className="plaza-featured-badge">波源</div>}
                    <div className="plaza-info">
                      <div className="plaza-author">
                        <span className="author-avatar" style={{
                          background: `hsl(${((renderOwner(item)).charCodeAt(0) || 0) * 137 % 360}, 70%, 60%)`
                        }}>
                          {(renderOwner(item)).charAt(0).toUpperCase()}
                        </span>
                        {renderOwner(item)}
                      </div>
                    </div>
                    <div className="admin-gallery-actions">
                      <button className="history-action-btn share" onClick={(e) => toggleFeatured(e, item)} type="button">
                        {item.isFeatured ? '取消波源' : '设为波源'}
                      </button>
                      <button className="history-action-btn delete" onClick={(e) => deleteGalleryItem(e, item)} type="button">
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="history-section">
              <h3>个人印记</h3>
              <div className="history-grid">
                {imprints.map(item => (
                  <div key={`imprint-${item.id}`} className="history-item" onClick={() => setSelectedItem(item)} style={{ cursor: 'pointer' }}>
                    <img src={item.url} alt={item.prompt} className="history-thumbnail" />
                    <div className="plaza-info">
                      <div className="plaza-author">
                        <span className="author-avatar" style={{
                          background: `hsl(${((renderOwner(item)).charCodeAt(0) || 0) * 137 % 360}, 70%, 60%)`
                        }}>
                          {(renderOwner(item)).charAt(0).toUpperCase()}
                        </span>
                        {renderOwner(item)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {selectedItem && (
        <div className="modal-overlay" onClick={() => setSelectedItem(null)}>
          <div className="modal-content prompt-detail-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', width: '90%', borderRadius: '16px', padding: '24px' }}>
            <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>✨ 作品详情</h3>
            
            {/* Image Container */}
            <div style={{ position: 'relative', width: '100%', borderRadius: '12px', overflow: 'hidden', marginBottom: '16px', background: '#000', display: 'flex', justifyContent: 'center' }}>
              <img
                src={selectedItem.filename ? `/uploads/${selectedItem.filename}` : selectedItem.url}
                alt={selectedItem.prompt}
                style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }}
              />
            </div>

            {/* Creator Information */}
            <div className="plaza-author" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '0.9rem' }}>生成者：</strong>
              <span className="author-avatar" style={{
                background: `hsl(${((renderOwner(selectedItem)).charCodeAt(0) || 0) * 137 % 360}, 70%, 60%)`,
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: '0.8rem',
                fontWeight: 'bold',
                marginRight: '4px'
              }}>
                {(renderOwner(selectedItem)).charAt(0).toUpperCase()}
              </span>
              <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{renderOwner(selectedItem)}</span>
            </div>

            {/* Prompt Block */}
            {selectedItem.prompt && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <strong style={{ fontSize: '0.9rem' }}>提示词 (Prompt)：</strong>
                  <button
                    className="settings-tab-btn active"
                    style={{ fontSize: '0.75rem', padding: '4px 8px', height: '28px', display: 'flex', alignItems: 'center' }}
                    onClick={() => {
                      navigator.clipboard.writeText(selectedItem.prompt);
                      alert('提示词已复制到剪贴板！');
                    }}
                  >
                    复制
                  </button>
                </div>
                <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem', wordBreak: 'break-all', whiteSpace: 'pre-wrap', color: 'var(--text-main)', textAlign: 'left' }}>
                  {selectedItem.prompt}
                </div>
              </div>
            )}

            {/* Caption Block */}
            {selectedItem.caption && (
              <div style={{ marginBottom: '16px' }}>
                <strong style={{ fontSize: '0.9rem' }}>分享感悟：</strong>
                <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-sub)', textAlign: 'left' }}>
                  {selectedItem.caption}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button className="modal-btn confirm" onClick={() => setSelectedItem(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Admin
