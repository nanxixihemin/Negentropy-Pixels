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

  // User and File Management state
  const [activeTab, setActiveTab] = useState('gallery')
  const [usersSummary, setUsersSummary] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState('')
  const [selectedUserForPreview, setSelectedUserForPreview] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

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

  const loadUsersSummary = useCallback(async () => {
    if (!token) return
    setUsersLoading(true)
    setUsersError('')
    try {
      const res = await fetch('/api/admin/users-summary', {
        headers: { Authorization: `Bearer ${token}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '加载用户数据失败')
      setUsersSummary(data || [])
    } catch (e) {
      setUsersError(e.message)
    } finally {
      setUsersLoading(false)
    }
  }, [token])

  useEffect(() => {
    loadImages()
  }, [loadImages])

  useEffect(() => {
    if (activeTab === 'users') {
      loadUsersSummary()
    }
  }, [activeTab, loadUsersSummary])

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
      if (activeTab === 'users') {
        loadUsersSummary()
      }
    } catch (e) {
      setError(e.message)
    }
  }

  const packageUserWorks = (userSummary) => {
    if (!token) return
    window.location.href = `/api/admin/users/package?id=${encodeURIComponent(userSummary.id)}&type=${userSummary.type}&token=${encodeURIComponent(token)}`
  }

  const cleanUserWorks = async (userSummary) => {
    const confirmMsg = userSummary.type === 'user'
      ? `确定要一键清理用户【${userSummary.name}】的所有作品吗？\n警告：这将永久删除其在磁盘上的 ${userSummary.totalImages} 张图片及数据库记录！`
      : `确定要一键清理访客【${userSummary.name}】的所有作品吗？\n警告：这将永久删除其在磁盘上的 ${userSummary.totalImages} 张图片及数据库记录！`

    if (!confirm(confirmMsg)) return

    try {
      setUsersLoading(true)
      const res = await fetch('/api/admin/users/clean', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ id: userSummary.id, type: userSummary.type })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '清理失败')
      alert('清理成功！')
      loadUsersSummary()
      loadImages()
      if (selectedUserForPreview && selectedUserForPreview.id === userSummary.id) {
        setSelectedUserForPreview(null)
      }
    } catch (e) {
      alert(e.message)
    } finally {
      setUsersLoading(false)
    }
  }

  const formatBytes = (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
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
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px', borderBottom: '2px solid var(--border-color)', paddingBottom: '8px' }}>
          <button
            className={`settings-tab-btn ${activeTab === 'gallery' ? 'active' : ''}`}
            onClick={() => setActiveTab('gallery')}
          >
            🖼️ 共享与画廊管理
          </button>
          <button
            className={`settings-tab-btn ${activeTab === 'users' ? 'active' : ''}`}
            onClick={() => setActiveTab('users')}
          >
            👥 用户与文件管理
          </button>
        </div>

        {activeTab === 'gallery' && (
          <>
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
          </>
        )}

        {activeTab === 'users' && (
          <>
            {usersLoading && usersSummary.length === 0 && <div className="loading-text">正在分析用户作品...</div>}
            {usersError && <div className="error-message">{usersError}</div>}

            {!usersError && (
              <>
                {/* Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
                  <div style={{ background: 'var(--bg-card)', padding: '16px', borderRadius: '12px', border: '2px solid var(--border-color)', boxShadow: '4px 4px 0px var(--border-color)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', fontWeight: 'bold' }}>👤 注册用户 / 访客</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '4px', color: 'var(--text-main)' }}>
                      {usersSummary.filter(u => u.type === 'user').length} <span style={{ fontSize: '0.9rem', fontWeight: 'normal', color: 'var(--text-sub)' }}>/ {usersSummary.filter(u => u.type === 'guest').length}</span>
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg-card)', padding: '16px', borderRadius: '12px', border: '2px solid var(--border-color)', boxShadow: '4px 4px 0px var(--border-color)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', fontWeight: 'bold' }}>🖼️ 作品总数</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '4px', color: 'var(--text-main)' }}>
                      {usersSummary.reduce((sum, u) => sum + u.totalImages, 0)} <span style={{ fontSize: '0.9rem', fontWeight: 'normal' }}>张</span>
                    </div>
                  </div>
                  <div style={{ background: 'var(--bg-card)', padding: '16px', borderRadius: '12px', border: '2px solid var(--border-color)', boxShadow: '4px 4px 0px var(--border-color)' }}>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-sub)', fontWeight: 'bold' }}>💾 磁盘总占用</div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginTop: '4px', color: 'var(--text-main)' }}>
                      {formatBytes(usersSummary.reduce((sum, u) => sum + u.totalSize, 0))}
                    </div>
                  </div>
                </div>

                {/* Search & Refresh */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    placeholder="🔍 输入用户名、昵称或设备ID搜索..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{
                      flex: '1',
                      minWidth: '240px',
                      padding: '10px 16px',
                      borderRadius: '8px',
                      border: '2px solid var(--border-color)',
                      background: 'var(--bg-card)',
                      color: 'var(--text-main)',
                      fontSize: '0.9rem',
                    }}
                  />
                  <button
                    className="settings-tab-btn active"
                    style={{ height: '42px', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                    onClick={loadUsersSummary}
                  >
                    🔄 刷新数据
                  </button>
                </div>

                {/* User List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {usersSummary.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-sub)', background: 'var(--bg-card)', borderRadius: '12px', border: '2px solid var(--border-color)' }}>
                      暂无用户及访客生图记录
                    </div>
                  ) : (
                    usersSummary.filter(user => {
                      const q = searchQuery.toLowerCase();
                      return user.name.toLowerCase().includes(q) || 
                             (user.username && user.username.toLowerCase().includes(q)) || 
                             user.id.toLowerCase().includes(q);
                    }).map(user => (
                      <div key={`${user.type}-${user.id}`} style={{
                        background: 'var(--bg-card)',
                        borderRadius: '12px',
                        border: '2px solid var(--border-color)',
                        boxShadow: '4px 4px 0px var(--border-color)',
                        padding: '16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '16px',
                        flexWrap: 'wrap',
                        transition: 'all 0.2s',
                      }}
                      className="user-management-row"
                      >
                        {/* User Details */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '240px', flex: '1' }}>
                          <span className="author-avatar" style={{
                            background: `hsl(${((user.name)).charCodeAt(0) * 137 % 360}, 70%, 60%)`,
                            width: '40px',
                            height: '40px',
                            borderRadius: '50%',
                            fontSize: '18px',
                            fontWeight: 'bold',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff'
                          }}>
                            {user.name.charAt(0).toUpperCase()}
                          </span>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <strong style={{ fontSize: '1rem', color: 'var(--text-main)' }}>{user.name}</strong>
                              {user.type === 'user' ? (
                                <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: user.role === 'admin' ? '#FFD166' : '#FF9F1C', color: '#000', borderRadius: '4px', fontWeight: 'bold' }}>
                                  {user.role === 'admin' ? '管理员' : '用户'}
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#e5e5ea', color: '#666', borderRadius: '4px', fontWeight: 'bold' }}>
                                  访客
                                </span>
                              )}
                            </div>
                            {user.username && (
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)', marginTop: '2px' }}>{user.username}</div>
                            )}
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)', marginTop: '2px' }}>
                              创建时间: {new Date(user.createdAt).toLocaleString()}
                            </div>
                          </div>
                        </div>

                        {/* Works Stats */}
                        <div style={{ minWidth: '150px' }}>
                          <div style={{ fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--text-main)' }}>
                            📁 {user.totalImages} 张作品
                          </div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-sub)', marginTop: '2px' }}>
                            (印记: {user.imprintCount} | 共享: {user.galleryCount})
                          </div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 'bold', color: user.totalSize > 10 * 1024 * 1024 ? '#ff9f1c' : 'var(--text-main)', marginTop: '4px' }}>
                            💾 {formatBytes(user.totalSize)}
                          </div>
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          <button
                            className="history-action-btn share"
                            style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', height: '34px', width: 'auto', position: 'static', opacity: 1 }}
                            onClick={() => setSelectedUserForPreview(user)}
                          >
                            🔍 浏览作品
                          </button>
                          <button
                            className="history-action-btn download"
                            style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', height: '34px', width: 'auto', position: 'static', opacity: 1 }}
                            onClick={() => packageUserWorks(user)}
                            disabled={user.totalImages === 0}
                          >
                            📦 打包作品
                          </button>
                          <button
                            className="history-action-btn delete"
                            style={{ padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', height: '34px', width: 'auto', position: 'static', opacity: 1 }}
                            onClick={() => cleanUserWorks(user)}
                            disabled={user.totalImages === 0}
                          >
                            🧹 清理作品
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {/* User Works Preview Modal */}
      {selectedUserForPreview && (
        <div className="modal-overlay" onClick={() => setSelectedUserForPreview(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px', width: '95%', borderRadius: '16px', padding: '24px', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
              <span>✨ 【{selectedUserForPreview.name}】的作品列表</span>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-sub)' }}>
                共 {selectedUserForPreview.totalImages} 张 ({formatBytes(selectedUserForPreview.totalSize)})
              </span>
            </h3>

            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '4px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '12px', minHeight: '300px' }}>
              {selectedUserForPreview.files.length === 0 ? (
                <div style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-sub)', fontSize: '0.9rem' }}>
                  该用户尚无任何图片作品
                </div>
              ) : (
                selectedUserForPreview.files.map(file => (
                  <div
                    key={file.name}
                    style={{
                      border: '2px solid var(--border-color)',
                      borderRadius: '8px',
                      overflow: 'hidden',
                      background: 'var(--bg-light)',
                      cursor: 'pointer',
                      position: 'relative'
                    }}
                    onClick={() => {
                      setSelectedItem({
                        id: file.dbId || file.name,
                        filename: file.urlPath.startsWith('/uploads/') ? file.urlPath.replace('/uploads/', '') : null,
                        url: file.urlPath,
                        prompt: file.prompt || '暂无提示词信息',
                        caption: file.caption || null,
                        nickname: selectedUserForPreview.name,
                        username: selectedUserForPreview.username,
                        deviceId: selectedUserForPreview.type === 'guest' ? selectedUserForPreview.id : null,
                        timestamp: file.timestamp
                      });
                    }}
                  >
                    <img src={file.urlPath} alt={file.name} style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
                    <div style={{ padding: '6px', fontSize: '0.75rem', color: 'var(--text-sub)', background: 'var(--bg-card)', borderTop: '1px solid var(--border-color)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                      {file.name.substring(file.name.indexOf('_') + 1)}
                    </div>
                    {file.isGallery && (
                      <span style={{ position: 'absolute', top: '4px', right: '4px', fontSize: '0.65rem', background: '#34c759', color: '#fff', padding: '1px 4px', borderRadius: '4px', fontWeight: 'bold' }}>
                        广场
                      </span>
                    )}
                    {file.isImprint && (
                      <span style={{ position: 'absolute', top: '4px', left: '4px', fontSize: '0.65rem', background: '#ffcc00', color: '#000', padding: '1px 4px', borderRadius: '4px', fontWeight: 'bold' }}>
                        印记
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', gap: '12px' }}>
              <button
                className="settings-tab-btn active"
                style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }}
                onClick={() => packageUserWorks(selectedUserForPreview)}
                disabled={selectedUserForPreview.totalImages === 0}
              >
                📦 打包该用户作品
              </button>
              <button className="modal-btn cancel" style={{ width: 'auto', marginTop: 0 }} onClick={() => setSelectedUserForPreview(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selected Item Detail Modal */}
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
