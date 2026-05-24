import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import '../App.css'

const PRESET_MODELS = [
  'gpt5-4',
  'gpt5-5',
  'Qwen3_6',
  'deepseek-ai/DeepSeek-V4-Flash'
];

function Chat() {
  const navigate = useNavigate()

  const AUTH_STORAGE_KEY = 'negentropy_auth_token'
  const deviceId = localStorage.getItem('banana_device_id') || 'device_guest'
  const authToken = localStorage.getItem(AUTH_STORAGE_KEY) || ''
  const authHeaders = () => authToken ? { Authorization: `Bearer ${authToken}` } : {}

  const syncSessionToServer = async (session) => {
    if (!session) return
    try {
      await fetch('/api/chat-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          id: String(session.id),
          title: session.title,
          messages: session.messages,
          deviceId,
          timestamp: session.timestamp
        })
      })
    } catch (e) {
      console.warn('Failed to sync chat session to server', e)
    }
  }

  const deleteSessionFromServer = async (sessionId) => {
    try {
      await fetch(`/api/chat-sessions/${sessionId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ deviceId })
      })
    } catch (e) {
      console.warn('Failed to delete chat session from server', e)
    }
  }

  // --- Settings State ---
  const [apiKey, setApiKey] = useState('')
  const [apiUrl, setApiUrl] = useState('https://generativelanguage.googleapis.com')
  const [model, setModel] = useState('gpt5-4')
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
        setApiUrl(parsed.apiUrl || 'https://generativelanguage.googleapis.com')
        if (parsed.model && (parsed.model.includes('gemini') || parsed.model.includes('exp'))) {
          // Auto-fix legacy experimental/Gemini IDs
          setModel('gpt5-4')
        } else {
          setModel(parsed.model || 'gpt5-4')
        }
      }
    } catch (e) {}

    // 2. Load Sessions from Database
    const loadSessions = async () => {
      try {
        const res = await fetch(`/api/chat-sessions?deviceId=${encodeURIComponent(deviceId)}`, {
          headers: authHeaders()
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '加载对话失败')

        if (Array.isArray(data) && data.length > 0) {
          setSessions(data)
          saveSessionsToStorage(data)
          setCurrentSessionId(data[0].id)
          return
        }

        // Fallback: If database is empty, check localStorage
        const savedSessions = localStorage.getItem('banana_chat_sessions')
        if (savedSessions) {
          const parsedSessions = JSON.parse(savedSessions)
          setSessions(parsedSessions)
          if (parsedSessions.length > 0) {
            setCurrentSessionId(parsedSessions[0].id)
            // Sync local storage sessions to database
            await Promise.all(parsedSessions.map(s => syncSessionToServer(s)))
            return
          }
        }

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
          await syncSessionToServer(newSession)
          return
        }

        // If no history at all, start fresh
        createNewSession()
      } catch (e) {
        console.warn("Failed to load chat data from server, falling back to local storage", e)
        // Fallback to local storage
        const savedSessions = localStorage.getItem('banana_chat_sessions')
        if (savedSessions) {
          const parsedSessions = JSON.parse(savedSessions)
          setSessions(parsedSessions)
          if (parsedSessions.length > 0) {
            setCurrentSessionId(parsedSessions[0].id)
            return
          }
        }
        createNewSession()
      }
    }

    loadSessions()
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
    syncSessionToServer(newSession)
    if (window.innerWidth <= 768) setIsSidebarOpen(false) // Mobile UX
  }

  // Delete Session
  const deleteSession = (e, id) => {
    e.stopPropagation()
    if (!confirm('确定删除这个对话吗？')) return

    const updated = sessions.filter(s => s.id !== id)
    setSessions(updated)
    saveSessionsToStorage(updated)
    deleteSessionFromServer(id)

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

    // Check if using Google AI Studio (Gemini) handling (Default)
    const isDefaultProxy = !apiUrl || apiUrl.includes('googleapis.com');

    if (!isDefaultProxy && !apiKey) {
      alert('使用自定义源时，请先配置 API Key')
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
    syncSessionToServer(updatedSession)

    setInput('')
    setIsLoading(true)

    try {
      let data;
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

      const aiMsg = { role: 'model', content: data.reply }
      const finalMessages = [...updatedMessages, aiMsg]

      const finalSession = { ...updatedSession, messages: finalMessages }
      const finalSessions = sessions.map(s => s.id === currentSessionId ? finalSession : s)

      setSessions(finalSessions)
      saveSessionsToStorage(finalSessions)
      syncSessionToServer(finalSession)

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

  const formatMessageContent = (content) => {
    if (!content) return '';
    
    // Split content by newlines
    const lines = content.split('\n');
    return lines.map((line, lineIdx) => {
      let cleanLine = line;
      
      // Check if it's a separator
      if (/^---+\s*$/.test(cleanLine)) {
        return <hr key={lineIdx} style={{ margin: '12px 0', border: 'none', borderTop: '1px solid rgba(0,0,0,0.1)' }} />;
      }
      
      // Check if it's a heading like ### text or ## text
      const headingMatch = cleanLine.match(/^(#{1,6})\s+(.+)$/);
      let isHeading = false;
      let headingLevel = 0;
      if (headingMatch) {
        headingLevel = headingMatch[1].length;
        cleanLine = headingMatch[2];
        isHeading = true;
      }
      
      // Process bold text like **bold** -> <strong>bold</strong>
      const parts = [];
      let lastIdx = 0;
      const boldRegex = /\*\*([^*]+)\*\*/g;
      let match;
      while ((match = boldRegex.exec(cleanLine)) !== null) {
        if (match.index > lastIdx) {
          parts.push(cleanLine.substring(lastIdx, match.index));
        }
        parts.push(<strong key={match.index}>{match[1]}</strong>);
        lastIdx = boldRegex.lastIndex;
      }
      if (lastIdx < cleanLine.length) {
        parts.push(cleanLine.substring(lastIdx));
      }
      
      // Render
      if (isHeading) {
        if (headingLevel === 1) return <h1 key={lineIdx} style={{ margin: '10px 0 6px 0', fontSize: '1.4rem', fontWeight: 800 }}>{parts}</h1>;
        if (headingLevel === 2) return <h2 key={lineIdx} style={{ margin: '8px 0 5px 0', fontSize: '1.2rem', fontWeight: 700 }}>{parts}</h2>;
        return <h3 key={lineIdx} style={{ margin: '6px 0 4px 0', fontSize: '1.05rem', fontWeight: 700 }}>{parts}</h3>;
      }
      
      return (
        <div key={lineIdx} style={{ minHeight: '1.2em' }}>
          {parts}
        </div>
      );
    });
  };

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
                {formatMessageContent(msg.content)}
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
                value={!PRESET_MODELS.includes(model) ? 'custom' : model}
                onChange={e => {
                  const val = e.target.value;
                  if (val === 'custom') {
                    setModel('custom-model-id');
                  } else {
                    setModel(val);
                  }
                }}
                style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #ddd' }}
              >
                <option value="gpt5-4">gpt5-4</option>
                <option value="gpt5-5">gpt5-5</option>
                <option value="Qwen3_6">Qwen3_6</option>
                <option value="deepseek-ai/DeepSeek-V4-Flash">deepseek-ai/DeepSeek-V4-Flash</option>
                <option value="custom">自定义...</option>
              </select>
              {!PRESET_MODELS.includes(model) && (
                <input
                  type="text"
                  placeholder="输入模型 ID"
                  value={model === 'custom-model-id' ? '' : model}
                  onChange={e => setModel(e.target.value)}
                  style={{ marginTop: '5px' }}
                />
              )}
            </div>

            <div className="input-group">
              <label>API Key {(!apiUrl || apiUrl.includes('googleapis.com')) && <span style={{ fontSize: '0.8em', color: '#888' }}>(由服务器托管)</span>}</label>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                disabled={!apiUrl || apiUrl.includes('googleapis.com')}
                placeholder={(!apiUrl || apiUrl.includes('googleapis.com')) ? "无需填写" : "sk-..."}
              />
            </div>

            <div className="input-group">
              <label>API Base URL</label>
              <select
                value={['https://store.hachimi-ai.com', 'https://api-inference.modelscope.cn/v1', 'http://10.10.0.35/v1', 'https://generativelanguage.googleapis.com'].includes(apiUrl) ? apiUrl : 'custom'}
                onChange={e => {
                  const val = e.target.value;
                  if (val === 'custom') {
                    setApiUrl('custom-url');
                  } else {
                    setApiUrl(val);
                  }
                }}
                style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid #ddd' }}
              >
                <option value="https://store.hachimi-ai.com">https://store.hachimi-ai.com</option>
                <option value="https://api-inference.modelscope.cn/v1">https://api-inference.modelscope.cn/v1</option>
                <option value="http://10.10.0.35/v1">http://10.10.0.35/v1</option>
                <option value="https://generativelanguage.googleapis.com">https://generativelanguage.googleapis.com (默认)</option>
                <option value="custom">自定义...</option>
              </select>
              {!['https://store.hachimi-ai.com', 'https://api-inference.modelscope.cn/v1', 'http://10.10.0.35/v1', 'https://generativelanguage.googleapis.com'].includes(apiUrl) && (
                <input
                  type="text"
                  value={apiUrl === 'custom-url' ? '' : apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="输入自定义 API 地址"
                  style={{ marginTop: '5px' }}
                />
              )}
            </div>

            <button className="generate-btn" style={{ marginTop: '10px', padding: '8px' }} onClick={saveSettings}>保存配置</button>
          </div>
        )}

      </div>
    </div>
  )
}

export default Chat
