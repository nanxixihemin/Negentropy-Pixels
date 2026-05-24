import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../App.css'

const AUTH_STORAGE_KEY = 'negentropy_auth_token'

function Admin() {
  const navigate = useNavigate()
  const [gallery, setGallery] = useState([])
  const [imprints, setImprints] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem(AUTH_STORAGE_KEY)
    if (!token) {
      setError('需要管理员登录')
      setLoading(false)
      return
    }

    const loadImages = async () => {
      try {
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
    }

    loadImages()
  }, [])

  const renderOwner = (item) => item.nickname || item.username || item.deviceId || '未归属'

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
                    <div className="plaza-info">
                      <div className="plaza-author">{renderOwner(item)}</div>
                      {item.prompt && <div className="plaza-prompt">{item.prompt}</div>}
                      {item.caption && <div className="plaza-caption">{item.caption}</div>}
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
                      {item.prompt && <div className="plaza-prompt">{item.prompt}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}

export default Admin
