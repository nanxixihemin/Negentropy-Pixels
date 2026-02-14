import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import '../App.css'

function Chat() {
  const navigate = useNavigate()

  // --- Settings State ---
  const [apiKey, setApiKey] = useState('AIzaSyDmZYG9_Qoego684v-mIyCXCjEHllBiUuY')
  const [apiUrl, setApiUrl] = useState('https://generativelanguage.googleapis.com')
  const [model, setModel] = useState('gemini-2.0-flash')
  const [showSettings, setShowSettings] = useState(false)

  // --- Multi-Session State ---
  const [sessions, setSessions] = useState([])
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)

  // Helper: Get Current Session
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const messages = currentSession ? currentSession.messages : []

  // Load Data
  useEffect(() => {
    try {
      // 1. Settings
      const savedSettings = localStorage.getItem('banana_chat_api_settings')
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings)
        setApiKey(parsed.apiKey || 'AIzaSyDmZYG9_Qoego684v-mIyCXCjEHllBiUuY')
        if (parsed.model && parsed.model.includes('exp')) {
          // Auto-fix legacy experimental IDs
          setModel('gemini-2.0-flash')
        } else {
          setModel(parsed.model || 'gemini-2.0-flash')
        }
      }

      // 2. Sessions (with Migration)
      const savedSessions = localStorage.getItem('banana_chat_sessions')
      if (savedSessions) {
        const parsedSessions = JSON.parse(savedSessions)
        setSessions(parsedSessions)
        if (parsedSessions.length > 0) {
          setCurrentSessionId(parsedSessions[0].id)
        } else {
          createNewSession()
        }
      } else {
        // Migration: Check for legacy single history
        const legacyHistory = localStorage.getItem('banana_chat_history')
        if (legacyHistory) {
          const msgs = JSON.parse(legacyHistory)
          const newSession = {
            id: Date.now(),
            title: msgs.length > 1 ? (msgs[1].content.substring(0, 15) + '...') : '历史对话',
            messages: msgs,
            timestamp: Date.now()
          }
          setSessions([newSession])
          setCurrentSessionId(newSession.id)
          saveSessionsToStorage([newSession])
        } else {
          // No history at all, start fresh
          createNewSession()
        }
      }
    } catch (e) {
      console.warn("Failed to load chat data", e)
    }
  }, [])

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Save Sessions Helper
  const saveSessionsToStorage = (updatedSessions) => {
    localStorage.setItem('banana_chat_sessions', JSON.stringify(updatedSessions))
  }

  // Save Settings
  const saveSettings = () => {
    const settings = { apiKey, apiUrl, model }
    localStorage.setItem('banana_chat_api_settings', JSON.stringify(settings))
    setShowSettings(false)
  }

  // Create New Session
  const createNewSession = () => {
    const newSession = {
      id: Date.now(),
      title: '新对话',
      messages: [{ role: 'model', content: '你好！我是你的创意助手，我们聊点什么？' }],
      timestamp: Date.now()
    }
    const updated = [newSession, ...sessions]
    setSessions(updated)
    setCurrentSessionId(newSession.id)
    saveSessionsToStorage(updated)
    if (window.innerWidth <= 768) setIsSidebarOpen(false) // Mobile UX
  }

  // Delete Session
  const deleteSession = (e, id) => {
    e.stopPropagation()
    if (!confirm('确定删除这个对话吗？')) return

    const updated = sessions.filter(s => s.id !== id)
    setSessions(updated)
    saveSessionsToStorage(updated)

    if (currentSessionId === id) {
      if (updated.length > 0) {
        setCurrentSessionId(updated[0].id)
      } else {
        createNewSession() // Don't leave empty
      }
    }
  }

  // Send Message
  const sendMessage = async () => {
    if (!input.trim() || isLoading || !currentSessionId) return

    if (!apiKey) {
      alert('请先在右上角设置中配置 API Key')
      setShowSettings(true)
      return
    }

    const userText = input.trim()
    const userMsg = { role: 'user', content: userText }

    // Optimistic Update
    const updatedMessages = [...messages, userMsg]

    // Update Title if needed
    let updatedTitle = currentSession.title
    if (messages.length <= 1) {
      updatedTitle = userText.substring(0, 20)
    }

    const updatedSession = {
      ...currentSession,
      messages: updatedMessages,
      title: updatedTitle,
      timestamp: Date.now()
    }

    const updatedSessions = sessions.map(s => s.id === currentSessionId ? updatedSession : s)
    setSessions(updatedSessions)
    setCurrentSessionId(currentSessionId)
    saveSessionsToStorage(updatedSessions)

    setInput('')
    setIsLoading(true)

    try {
      let data;

      // Check if using Google AI Studio (Gemini) handling
      if (apiUrl.includes('googleapis.com')) {
        // If targeting Google API (default or explicit), use relative path to leverage our server proxy
        const baseUrl = ''
        const endpoint = `/v1beta/models/${model}:generateContent?key=${apiKey}`

        // Convert history to Gemini format
        const contents = updatedMessages.map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }]
        }))

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents })
        })

        data = await res.json()

        if (!res.ok) {
          // Improve error message visibility
          const errorDetails = data.error?.message || data.error?.status || res.statusText
          throw new Error(`Gemini API Error: ${errorDetails}`)
        }

        // Extract response
        const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "No response"
        // Normalize for our app
        data = { reply }

      } else {
        // Fallback to OpenAI-compatible logic (or local proxy)
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: updatedMessages,
            apiKey: apiKey,
            apiUrl: apiUrl,
            model: model
          })
        })
        data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Request failed')
      }

      const aiMsg = { role: 'model', content: data.reply }
      const finalMessages = [...updatedMessages, aiMsg]

      const finalSession = { ...updatedSession, messages: finalMessages }
      const finalSessions = sessions.map(s => s.id === currentSessionId ? finalSession : s)

      setSessions(finalSessions)
      saveSessionsToStorage(finalSessions)

    } catch (err) {
      let friendlyError = err.message

      // Rate Limit / Quota Check
      if (err.message.includes('Quota exceeded') || err.message.includes('429')) {
        friendlyError = "⚠️ 免费版调用太频繁 (Rate Limit)。请休息 20 秒后再试。"
      } else if (err.message.includes('not found')) {
        friendlyError = "⚠️ 模型未找到。请在设置中切换为 'Gemini 2.0 Flash'。"
      } else if (err.message.includes('API key')) {
        friendlyError = "⚠️ API Key 无效。请检查设置。"
      }

      const errorMsg = { role: 'model', content: friendlyError }
      const finalSessions = sessions.map(s => s.id === currentSessionId ? { ...s, messages: [...updatedMessages, errorMsg] } : s)
      setSessions(finalSessions)
    } finally {
      setIsLoading(false)
    }
  }

  // Mobile Sidebar Toggle
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  return (
    <div className="chat-page-container">
      {/* Sidebar Overlay */}
      <div
        className={`sidebar-overlay ${isSidebarOpen ? 'visible' : ''}`}
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Sidebar */}
      <div className={`chat-sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <button className="new-chat-btn" onClick={createNewSession}>
          <span>+</span> 新建对话
        </button>

        <div className="session-list">
          {sessions.map(session => (
            <div
              key={session.id}
              className={`session-item ${session.id === currentSessionId ? 'active' : ''}`}
              onClick={() => {
                setCurrentSessionId(session.id)
                if (window.innerWidth <= 768) setIsSidebarOpen(false)
              }}
            >
              <span>{session.title}</span>
              <button
                className="delete-session-btn"
                onClick={(e) => deleteSession(e, session.id)}
                title="删除会话"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="chat-main-area">
        {/* Header (Reused styles) */}
        <div className="chat-header-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {/* Mobile Menu Btn */}
            {/* Menu Btn - Visible on all screens now */}
            <button
              className="chat-page-back-btn"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              title="切换历史记录"
            >
              ☰
            </button>

            <button className="chat-trigger-btn" onClick={() => navigate('/')}>
              ← 返回创作
            </button>
            <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>
              {currentSession ? currentSession.title : '勾勒'}
            </h3>
          </div>

          <button className="settings-btn" onClick={() => setShowSettings(!showSettings)} style={{ width: '32px', height: '32px' }}>
            ⚙️
          </button>
        </div>

        {/* Messages */}
        <div className="chat-window full-page-chat" style={{ background: 'transparent' }}>
          <div className="chat-messages" ref={scrollRef}>
            {messages.map((msg, idx) => (
              <div key={idx} className={`chat-bubble ${msg.role}`}>
                {msg.content}
              </div>
            ))}
            {isLoading && <div className="chat-bubble model loading">AI 正在思考...</div>}
          </div>

          <div className="chat-input-area">
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="输入灵感..."
              disabled={isLoading}
            />
            <button className="send-btn" onClick={sendMessage} disabled={isLoading || !input.trim()}>➤</button>
          </div>
        </div>

        {/* Settings Modal (Clean) */}
        {showSettings && (
          <div className="chat-settings-modal">
            <div className="chat-settings-header">
              <h3>独立配置</h3>
              <button className="close-text-btn" onClick={() => setShowSettings(false)}>×</button>
            </div>

            <div className="input-group">
              <label>Model (模型选择)</label>
              <select
                value={model}
                onChange={e => setModel(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #ddd' }}
              >
                <option value="gemini-2.0-flash">Gemini 2.0 Flash (推荐)</option>
                <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite (极速)</option>
                <option value="gemini-2.0-flash-001">Gemini 2.0 Flash-001 (稳定)</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash (最新)</option>
                <option value="gemini-1.5-flash">Gemini 1.5 Flash</option>
                <option value="custom">自定义...</option>
              </select>
              {model === 'custom' && (
                <input
                  type="text"
                  placeholder="输入模型 ID"
                  onChange={e => setModel(e.target.value)}
                  style={{ marginTop: '5px' }}
                />
              )}
            </div>

            <div className="input-group">
              <label>API Key</label>
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} />
            </div>

            <div className="input-group">
              <label>API Base URL</label>
              <input type="text" value={apiUrl} onChange={e => setApiUrl(e.target.value)} />
            </div>

            <button className="generate-btn" style={{ marginTop: '10px', padding: '8px' }} onClick={saveSettings}>保存配置</button>
          </div>
        )}

      </div>
    </div>
  )
}

export default Chat
