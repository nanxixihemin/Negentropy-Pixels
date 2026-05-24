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
  const [detail, setDetail] = useState(null)

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

  const toggleFeatured = async (item) => {
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

  const deleteGalleryItem = async (item) => {
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

  const renderOwner = (item) => item.nickname || item.username || item.deviceId || '未归属'
  const showPromptDetail = (item) => {
    setDetail({
      title: `${renderOwner(item)} 的提示词`,
      text: item.prompt
    })
  }

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
                  <div key={`gallery-${item.id}`} className="plaza-item">
                    <img src={`/uploads/${item.filename}`} alt={item.prompt} className="plaza-thumbnail" />
                    {item.isFeatured && <div className="plaza-featured-badge">波源</div>}
                    <div className="plaza-info">
                      <div className="plaza-author">{renderOwner(item)}</div>
                      {item.prompt && (
                        <button className="prompt-preview-btn" onClick={() => showPromptDetail(item)} type="button">
                          <span className="badge-tag">提示词</span>
                          <span>{item.prompt}</span>
                        </button>
                      )}
                      {item.caption && <div className="plaza-caption">{item.caption}</div>}
                    </div>
                    <div className="admin-gallery-actions">
                      <button className="history-action-btn share" onClick={() => toggleFeatured(item)} type="button">
                        {item.isFeatured ? '取消波源' : '设为波源'}
                      </button>
                      <button className="history-action-btn delete" onClick={() => deleteGalleryItem(item)} type="button">
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
                  <div key={`imprint-${item.id}`} className="history-item">
                    <img src={item.url} alt={item.prompt} className="history-thumbnail" />
                    <div className="plaza-info">
                      <div className="plaza-author">{renderOwner(item)}</div>
                      {item.prompt && (
                        <button className="prompt-preview-btn" onClick={() => showPromptDetail(item)} type="button">
                          <span className="badge-tag">提示词</span>
                          <span>{item.prompt}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal-content prompt-detail-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{detail.title}</h3>
            <div className="prompt-detail-text">{detail.text}</div>
            <button className="modal-btn confirm" onClick={() => setDetail(null)} type="button">
              关闭
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default Admin
