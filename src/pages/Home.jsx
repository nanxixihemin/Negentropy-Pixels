
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import '../App.css'

// 风格预设
const STYLE_PRESETS = [
  { id: 'anime', label: '动漫', suffix: ', anime style, vibrant colors, clean lines' },
  { id: 'oil', label: '油画', suffix: ', oil painting style, rich textures, classic art' },
  { id: 'watercolor', label: '水彩', suffix: ', watercolor painting, soft colors, fluid strokes' },
  { id: 'cyberpunk', label: '赛博朋克', suffix: ', cyberpunk style, neon lights, futuristic' },
  { id: 'ghibli', label: '吉卜力', suffix: ', studio ghibli style, dreamy, whimsical' },
  { id: 'pixel', label: '像素', suffix: ', pixel art style, 8-bit, retro game' },
  { id: 'sketch', label: '素描', suffix: ', pencil sketch, black and white, detailed shading' },
  { id: 'photo', label: '写实', suffix: ', photorealistic, 8k, highly detailed, professional photography' },
]

// 图片比例
const ASPECT_RATIOS = [
  { id: '1:1', label: '1:1', width: 1024, height: 1024 },
  { id: '16:9', label: '16:9', width: 1344, height: 768 },
  { id: '9:16', label: '9:16', width: 768, height: 1344 },
  { id: '4:3', label: '4:3', width: 1152, height: 896 },
  { id: '3:4', label: '3:4', width: 896, height: 1152 },
]

// 画质/细节等级
const QUALITY_LEVELS = [
  { id: 'default', label: '默认', suffix: '' },
  { id: 'high', label: '高清', suffix: ', high quality, highly detailed, sharp focus' },
  { id: 'ultra', label: '超清', suffix: ', 8k resolution, best quality, masterpiece, ultra detailed, professional photography' },
  { id: 'extreme', label: '极致', suffix: ', 16k, insane details, intricate, hyperdetailed, unreal engine 5 render' },
]

// 默认提示词模板
const DEFAULT_TEMPLATES = [
  { id: 1, name: '可爱猫咪', prompt: 'a cute fluffy cat sitting on a windowsill, sunlight' },
  { id: 2, name: '梦幻风景', prompt: 'beautiful fantasy landscape with floating islands and waterfalls' },
  { id: 3, name: '美食特写', prompt: 'delicious food photography, close-up, professional lighting' },
  { id: 4, name: '未来城市', prompt: 'futuristic city skyline at sunset, flying cars, holographic ads' },
  { id: 5, name: '人物肖像', prompt: 'portrait of a person, soft lighting, detailed features' },
]

// 模型列表
const AVAILABLE_MODELS = [
  { id: 'gemini-3-pro-image-preview', label: 'Gemini 3 Pro Image (Preview, 推荐)' },
  { id: 'gpt-image2', label: 'gpt-image2' },
  { id: 'custom', label: '自定义模型...' }
]

const HISTORY_STORAGE_KEY = 'banana_home_history'
const LEGACY_HISTORY_STORAGE_KEY = 'banana_history'
const AUTH_STORAGE_KEY = 'negentropy_auth_token'

function readLocalHistory() {
  try {
    const saved = localStorage.getItem(HISTORY_STORAGE_KEY) || localStorage.getItem(LEGACY_HISTORY_STORAGE_KEY)
    return saved ? JSON.parse(saved) : []
  } catch (e) {
    console.error('Failed to parse history', e)
    return []
  }
}

function saveLocalHistory(history) {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(0, 20)))
  localStorage.removeItem(LEGACY_HISTORY_STORAGE_KEY)
}

function Home() {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [imageUrl, setImageUrl] = useState(null)
  const [error, setError] = useState(null)
  const [mode, setMode] = useState('text2img') // 'text2img' | 'img2img'
  const [uploadedImage, setUploadedImage] = useState(null) // { base64, mimeType, preview }
  const [history, setHistory] = useState(() => readLocalHistory())

  // 创作增强功能状态
  const [selectedStyle, setSelectedStyle] = useState(null)
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [quality, setQuality] = useState('default') // New Quality State

  // 模型设置 - 恢复为 Google API (用于生图)
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('banana_home_api_key') || '')
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('banana_home_api_url') || 'https://generativelanguage.googleapis.com')

  // Model State
  const [selectedModelId, setSelectedModelId] = useState(() => localStorage.getItem('banana_home_model_id') || 'gemini-3-pro-image-preview')
  const [customModelName, setCustomModelName] = useState(() => localStorage.getItem('banana_home_custom_model_name') || '')
  const [authToken, setAuthToken] = useState(() => localStorage.getItem(AUTH_STORAGE_KEY) || '')
  const [currentUser, setCurrentUser] = useState(null)

  // “勾勒”对话设置 - 从 banana_chat_api_settings 初始化
  const [chatSettings, setChatSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('banana_chat_api_settings')
      if (saved) {
        const parsed = JSON.parse(saved)
        return {
          apiKey: parsed.apiKey || '',
          apiUrl: parsed.apiUrl || 'https://generativelanguage.googleapis.com',
          model: parsed.model || 'gpt5-4'
        }
      }
    } catch (e) {}
    return {
      apiKey: '',
      apiUrl: 'https://generativelanguage.googleapis.com',
      model: 'gpt5-4'
    }
  })
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ username: '', password: '', nickname: '', securityQuestion: '', securityAnswer: '' })
  const [authError, setAuthError] = useState('')
  const [recoveryForm, setRecoveryForm] = useState({ username: '', securityQuestion: '', securityAnswer: '', newPassword: '' })
  const [recoverySuccess, setRecoverySuccess] = useState('')

  // Persistence Effects
  useEffect(() => { localStorage.setItem('banana_home_api_key', apiKey) }, [apiKey])
  useEffect(() => { localStorage.setItem('banana_home_api_url', apiUrl) }, [apiUrl])
  useEffect(() => { localStorage.setItem('banana_home_model_id', selectedModelId) }, [selectedModelId])
  useEffect(() => { localStorage.setItem('banana_home_custom_model_name', customModelName) }, [customModelName])
  useEffect(() => { localStorage.setItem('banana_home_prompt', prompt) }, [prompt])
  useEffect(() => {
    if (selectedStyle) localStorage.setItem('banana_home_style', JSON.stringify(selectedStyle))
    else localStorage.removeItem('banana_home_style')
  }, [selectedStyle])
  useEffect(() => { localStorage.setItem('banana_home_ratio', aspectRatio) }, [aspectRatio])
  useEffect(() => { localStorage.setItem('banana_home_quality', quality) }, [quality]) // Save Quality
  useEffect(() => {
    if (authToken) localStorage.setItem(AUTH_STORAGE_KEY, authToken)
    else localStorage.removeItem(AUTH_STORAGE_KEY)
  }, [authToken])

  useEffect(() => {
    localStorage.setItem('banana_chat_api_settings', JSON.stringify(chatSettings))
  }, [chatSettings])

  // Save History (Limit to 20 items to avoid quota issues with base64)
  useEffect(() => {
    try {
      saveLocalHistory(history);
    } catch (e) {
      console.warn('Storage quota exceeded, could not save history');
    }
  }, [history])

  const authHeaders = () => authToken ? { Authorization: `Bearer ${authToken}` } : {}

  // Load Initial State
  useEffect(() => {
    const savedPrompt = localStorage.getItem('banana_home_prompt')
    if (savedPrompt) setPrompt(savedPrompt)

    const savedStyle = localStorage.getItem('banana_home_style')
    if (savedStyle) setSelectedStyle(JSON.parse(savedStyle))

    const savedRatio = localStorage.getItem('banana_home_ratio')
    if (savedRatio) setAspectRatio(savedRatio)

    const savedQuality = localStorage.getItem('banana_home_quality')
    if (savedQuality) setQuality(savedQuality)

    // Auto-migrate invalid model ID
    const savedModel = localStorage.getItem('banana_home_model_id')
    if (savedModel === 'gemini-3-pro-image') {
      setSelectedModelId('gemini-3-pro-image-preview')
    }
  }, [])

  // Refs
  const textareaRef = useRef(null)

  // Derived model name for API
  const model = selectedModelId === 'custom' ? customModelName : selectedModelId

  // AI 提示词炼金术状态
  const [isRefining, setIsRefining] = useState(false)

  // --- 追问式炼金 (Co-pilot) 状态 (Refactored to /assistant page) ---
  // Legacy state removed or cleaned up

  // 炼金术逻辑

  // 炼金术逻辑
  const refinePrompt = async () => {
    const textarea = textareaRef.current
    if (!textarea || !prompt.trim()) {
      alert('请输入一点想法，哪怕是一个词')
      return
    }

    // Capture selection
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const hasSelection = start !== end
    const textToRefine = hasSelection ? prompt.substring(start, end) : prompt

    if (!textToRefine.trim()) {
      alert('请选择有效的文本')
      return
    }

    setIsRefining(true)
    try {
      const res = await fetch('/api/refine-prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: textToRefine,
          apiKey: chatSettings.apiKey,
          apiUrl: chatSettings.apiUrl,
          model: chatSettings.model
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '炼金失败')

      const refinedText = data.refinedPrompt

      if (hasSelection) {
        const newPrompt = prompt.substring(0, start) + refinedText + prompt.substring(end)
        setPrompt(newPrompt)
      } else {
        setPrompt(refinedText)
      }
    } catch (err) {
      alert(err.message)
    } finally {
      setIsRefining(false)
    }
  }

  // ... (templates state)
  const [customTemplates, setCustomTemplates] = useState(() => {
    try {
      const saved = localStorage.getItem('banana_templates')
      return saved ? JSON.parse(saved) : []
    } catch (e) { return [] }
  })
  const [hiddenTemplates, setHiddenTemplates] = useState(() => {
    try {
      const saved = localStorage.getItem('banana_hidden_templates')
      return saved ? JSON.parse(saved) : []
    } catch (e) { return [] }
  })
  const [showTemplates, setShowTemplates] = useState(false)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')

  // 风格管理
  const [customStyles, setCustomStyles] = useState(() => {
    try {
      const saved = localStorage.getItem('banana_styles')
      return saved ? JSON.parse(saved) : []
    } catch (e) { return [] }
  })
  const [hiddenStyles, setHiddenStyles] = useState(() => {
    try {
      const saved = localStorage.getItem('banana_hidden_styles')
      return saved ? JSON.parse(saved) : []
    } catch (e) { return [] }
  })
  const [showStyles, setShowStyles] = useState(false)
  const [showStyleModal, setShowStyleModal] = useState(false)
  const [newStyleLabel, setNewStyleLabel] = useState('')
  const [newStyleSuffix, setNewStyleSuffix] = useState('')




  // --- 模板管理 ---
  const addCustomTemplate = () => {
    if (!prompt.trim() || !newTemplateName.trim()) {
      alert('请输入模板名称和提示词')
      return
    }
    const newTemplate = {
      id: Date.now(),
      name: newTemplateName.trim(),
      prompt: prompt.trim(),
      isCustom: true
    }
    const updated = [...customTemplates, newTemplate]
    setCustomTemplates(updated)
    localStorage.setItem('banana_templates', JSON.stringify(updated))
    setNewTemplateName('')
    setShowTemplateModal(false)
  }

  const deleteCustomTemplate = (id) => {
    if (!confirm('确定删除这个模板吗？')) return
    const updated = customTemplates.filter(t => t.id !== id)
    setCustomTemplates(updated)
    localStorage.setItem('banana_templates', JSON.stringify(updated))
  }

  const toggleHiddenTemplate = (id) => {
    let updated
    if (hiddenTemplates.includes(id)) {
      updated = hiddenTemplates.filter(hid => hid !== id)
    } else {
      updated = [...hiddenTemplates, id]
    }
    setHiddenTemplates(updated)
    localStorage.setItem('banana_hidden_templates', JSON.stringify(updated))
  }

  // --- 风格管理 ---
  const addCustomStyle = () => {
    if (!newStyleLabel.trim() || !newStyleSuffix.trim()) {
      alert('请输入风格名称和后缀')
      return
    }
    const newStyle = {
      id: 'custom_' + Date.now(),
      label: newStyleLabel.trim(),
      suffix: newStyleSuffix.trim(),
      isCustom: true
    }
    const updated = [...customStyles, newStyle]
    setCustomStyles(updated)
    localStorage.setItem('banana_styles', JSON.stringify(updated))
    setNewStyleLabel('')
    setNewStyleSuffix('')
    setShowStyleModal(false)
  }

  const deleteCustomStyle = (id) => {
    if (!confirm('确定删除这个风格吗？')) return
    const updated = customStyles.filter(s => s.id !== id)
    setCustomStyles(updated)
    localStorage.setItem('banana_styles', JSON.stringify(updated))
    if (selectedStyle === id) setSelectedStyle(null)
  }

  const toggleHiddenStyle = (id) => {
    let updated
    if (hiddenStyles.includes(id)) {
      updated = hiddenStyles.filter(hid => hid !== id)
    } else {
      updated = [...hiddenStyles, id]
    }
    setHiddenStyles(updated)
    localStorage.setItem('banana_hidden_styles', JSON.stringify(updated))
  }

  // 应用模板
  const applyTemplate = (template) => {
    setPrompt(template.prompt)
  }

  // 切换风格
  const toggleStyle = (styleId) => {
    setSelectedStyle(prev => prev === styleId ? null : styleId)
  }

  // 获取最终提示词
  const getFinalPrompt = () => {
    let finalPrompt = prompt
    if (selectedStyle) {
      const allStyles = [...STYLE_PRESETS, ...customStyles]
      const style = allStyles.find(s => s.id === selectedStyle)
      if (style) {
        finalPrompt += style.suffix
      }
    }
    // Append Quality Suffix
    const qualityConfig = QUALITY_LEVELS.find(q => q.id === quality)
    if (qualityConfig) {
      finalPrompt += qualityConfig.suffix
    }
    return finalPrompt
  }

  const addToHistory = (imageUrl, promptText) => {
    try {
      const newItem = {
        id: Date.now().toString(),
        url: imageUrl,
        prompt: promptText,
        timestamp: Date.now()
      }

      setHistory(prev => {
        const newHistory = [newItem, ...prev].slice(0, 20) // Limit to 20 items
        saveLocalHistory(newHistory)
        return newHistory
      })
      saveImprintToDatabase(newItem)
    } catch (e) {
      if (e.name === 'QuotaExceededError') {
        alert("本地存储空间已满，无法保存新图片，请删除一些旧记录。")
      } else {
        console.error("Failed to save history", e)
      }
    }
  }

  const removeFromHistory = (id) => {
    setHistory(prev => {
      const newHistory = prev.filter(item => item.id !== id)
      saveLocalHistory(newHistory)
      return newHistory
    })
    deleteImprintFromDatabase(id)
  }

  // Plaza (共享画廊) 状态
  const [activeTab, setActiveTab] = useState('create') // 'create' | 'plaza'
  const [publicGallery, setPublicGallery] = useState([])
  const [plazaFilter, setPlazaFilter] = useState('all')
  const [loadingGallery, setLoadingGallery] = useState(false)
  const [sharingId, setSharingId] = useState(null)
  const visiblePublicGallery = plazaFilter === 'featured'
    ? publicGallery.filter(item => item.isFeatured)
    : publicGallery

  // 昵称状态
  const [nickname, setNickname] = useState('')
  const [showShareModal, setShowShareModal] = useState(false)
  const [selectedGalleryItem, setSelectedGalleryItem] = useState(null)
  const [pendingShareItem, setPendingShareItem] = useState(null)
  const [shareWithNickname, setShareWithNickname] = useState(true)
  const [deviceId, setDeviceId] = useState('')
  const [shareCaption, setShareCaption] = useState('')

  // 加载昵称和设备ID
  useEffect(() => {
    const savedNickname = localStorage.getItem('banana_nickname')
    if (savedNickname) setNickname(savedNickname)

    // 生成或获取设备唯一ID
    let savedDeviceId = localStorage.getItem('banana_device_id')
    if (!savedDeviceId) {
      savedDeviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
      localStorage.setItem('banana_device_id', savedDeviceId)
    }
    setDeviceId(savedDeviceId)
  }, [])

  useEffect(() => {
    if (!deviceId) return

    let cancelled = false

    const loadImprints = async () => {
      try {
        const res = await fetch(`/api/imprints?deviceId=${encodeURIComponent(deviceId)}`, {
          headers: authHeaders()
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '加载印记失败')

        if (cancelled || !Array.isArray(data)) return

        if (data.length > 0) {
          setHistory(data)
          saveLocalHistory(data)
          return
        }

        const localHistory = readLocalHistory().slice(0, 20)
        if (localHistory.length > 0) {
          await Promise.all(localHistory.map(item => saveImprintToDatabase(item, deviceId)))
        }
      } catch (e) {
        console.warn('Failed to load imprints from database', e)
      }
    }

    loadImprints()

    return () => {
      cancelled = true
    }
  }, [deviceId, authToken])

  const saveImprintToDatabase = async (item, targetDeviceId = deviceId) => {
    if (!targetDeviceId || !item?.id || !item?.url) return

    try {
      await fetch('/api/imprints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          id: item.id,
          url: item.url,
          prompt: item.prompt || '',
          deviceId: targetDeviceId,
          timestamp: item.timestamp || Date.now()
        })
      })
    } catch (e) {
      console.warn('Failed to save imprint to database', e)
    }
  }

  const deleteImprintFromDatabase = async (id) => {
    if (!deviceId) return

    try {
      await fetch(`/api/imprints/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ deviceId })
      })
    } catch (e) {
      console.warn('Failed to delete imprint from database', e)
    }
  }

  const reworkHistoryImage = (item) => {
    if (!item || !item.url) return;
    
    if (item.url.startsWith('data:')) {
      const parts = item.url.split(',');
      if (parts.length === 2) {
        const mimeType = parts[0].match(/data:(.*?);/)?.[1] || 'image/png';
        const base64 = parts[1];
        
        setUploadedImage({
          base64,
          mimeType,
          preview: item.url
        });
        setMode('img2img');
        setActiveTab('create');
        if (item.prompt) {
          setPrompt(item.prompt);
        }
      }
    } else {
      fetch(item.url)
        .then(res => res.blob())
        .then(blob => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const dataUrl = reader.result;
            const base64 = dataUrl.split(',')[1];
            setUploadedImage({
              base64,
              mimeType: blob.type,
              preview: dataUrl
            });
            setMode('img2img');
            setActiveTab('create');
            if (item.prompt) {
              setPrompt(item.prompt);
            }
          };
          reader.readAsDataURL(blob);
        })
        .catch(err => {
          console.error("Failed to load image for rework", err);
          alert("图片加载失败，请重试");
        });
    }
  };

  // 保存昵称
  useEffect(() => {
    if (!authToken) {
      setCurrentUser(null)
      return
    }

    let cancelled = false
    const loadCurrentUser = async () => {
      try {
        const res = await fetch('/api/auth/me', { headers: authHeaders() })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '登录已失效')
        if (!cancelled) setCurrentUser(data.user)
      } catch (e) {
        if (!cancelled) {
          setAuthToken('')
          setCurrentUser(null)
        }
      }
    }

    loadCurrentUser()
    return () => {
      cancelled = true
    }
  }, [authToken])

  useEffect(() => {
    if (currentUser?.nickname && !nickname) {
      saveNickname(currentUser.nickname)
    }
  }, [currentUser])

  const submitAuth = async () => {
    setAuthError('')
    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '认证失败')

      setAuthToken(data.token)
      setCurrentUser(data.user)
      setShowSettings(false)
      setAuthForm({ username: '', password: '', nickname: '', securityQuestion: '', securityAnswer: '' })
    } catch (e) {
      setAuthError(e.message)
    }
  }

  const submitRecovery = async () => {
    setAuthError('')
    setRecoverySuccess('')
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recoveryForm)
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '重置密码失败')

      setRecoverySuccess('密码重置成功！请切换至“登录”页签进行登录。')
      setRecoveryForm({ username: '', securityQuestion: '', securityAnswer: '', newPassword: '' })
    } catch (e) {
      setAuthError(e.message)
    }
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', headers: authHeaders() })
    } catch (e) {}
    setAuthToken('')
    setCurrentUser(null)
  }

  const saveNickname = (name) => {
    setNickname(name)
    localStorage.setItem('banana_nickname', name)
  }

  // 获取公共画廊
  const fetchGallery = async () => {
    setLoadingGallery(true)
    try {
      const res = await fetch('/api/gallery')
      const data = await res.json()
      setPublicGallery(data)
    } catch (e) {
      console.error('获取画廊失败', e)
    } finally {
      setLoadingGallery(false)
    }
  }

  // 删除广场图片
  const deletePlazaItem = async (id) => {
    if (!confirm('确定要删除这张图片吗？')) return

    try {
      const res = await fetch(`/api/gallery/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ deviceId })
      })
      const data = await res.json()
      if (data.success) {
        fetchGallery()
      } else {
        alert(data.error || '删除失败')
      }
    } catch (e) {
      alert('删除失败: ' + e.message)
    }
  }

  // 打开分享弹窗
  const openShareModal = (item) => {
    setPendingShareItem(item)
    setShowShareModal(true)
  }

  // 确认分享
  const confirmShare = async () => {
    if (!pendingShareItem) return

    setSharingId(pendingShareItem.id)
    setShowShareModal(false)

    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          image: pendingShareItem.url,
          prompt: pendingShareItem.prompt,
          caption: shareCaption || null,
          author: shareWithNickname && nickname ? nickname : null,
          deviceId: deviceId
        })
      })
      const data = await res.json()
      if (data.success) {
        alert('✅ 分享成功！')
        fetchGallery()
      } else {
        throw new Error(data.error || '分享失败')
      }
    } catch (e) {
      alert('分享失败: ' + e.message)
    } finally {
      setSharingId(null)
      setPendingShareItem(null)
      setShareCaption('')
    }
  }

  // 切换到广场时加载数据
  useEffect(() => {
    if (activeTab === 'plaza') {
      fetchGallery()
    }
  }, [activeTab])

  const [showSettings, setShowSettings] = useState(false)

  // Handle image upload for img2img mode
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const dataUrl = event.target.result
      const base64 = dataUrl.split(',')[1]
      setUploadedImage({
        base64,
        mimeType: file.type,
        preview: dataUrl
      })
    }
    reader.readAsDataURL(file)
  }

  const removeUploadedImage = () => {
    setUploadedImage(null)
  }

  const generateImage = async () => {
    if (!prompt) return
    if (mode === 'img2img' && !uploadedImage) {
      setError('请先上传一张参考图片')
      return
    }

    setLoading(true)
    setError(null)
    setImageUrl(null)

    try {
      let finalPrompt = getFinalPrompt()

      if (aspectRatio !== '1:1') {
        finalPrompt += `, aspect ratio ${aspectRatio}`
      }

      const response = await fetch('/api/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: finalPrompt,
          model,
          apiUrl,
          apiKey,
          aspectRatio,
          quality,
          mode,
          uploadedImage
        })
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || `生图失败: ${response.statusText}`)
      }

      if (!data.imageUrl) {
        throw new Error('未在响应中找到图片数据')
      }

      setImageUrl(data.imageUrl)
      addToHistory(data.imageUrl, finalPrompt)
    } catch (err) {
      console.error(err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }


  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-top-row">
          <h1 className="art-title">Negentropy Pixels</h1>
          <div className="header-controls">
            {currentUser && currentUser.role === 'admin' && (
              <button className="settings-btn" onClick={() => navigate('/admin')}>管理</button>
            )}
            <button
              className="settings-btn"
              onClick={() => setShowSettings(!showSettings)}
              title="设置与账号"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="#5D5D5D">
                <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"></path>
              </svg>
              <span style={{ marginLeft: '4px', fontSize: '0.9rem', fontWeight: '800' }}>
                {currentUser ? `设置 (${currentUser.nickname || currentUser.username})` : '设置与登录'}
              </span>
            </button>
          </div>
        </div>





        <div className="manifesto-container">
          <h2 className="manifesto-main">
            <span className="chaos-text">无序归零</span>
            <span className="order-text">秩序新生</span>
          </h2>
          <h3 className="manifesto-sub">于像素微尘，见构筑宏构</h3>
          <div className="manifesto-footer">
            <button
              className="chat-trigger-btn"
              onClick={() => navigate('/chat')}
            >
              勾勒
            </button>
            <p className="manifesto-caption">—— 每一瞬，皆是精密重构</p>
          </div>
        </div>




      </header>

      {showSettings && (
        <div className="card settings-section glass-effect">
          <div className="settings-header">
            <h3>⚙️ 个人设置与账号中心</h3>
            <button className="close-mini-btn" onClick={() => setShowSettings(false)}>×</button>
          </div>
          <div className="settings-columns">
            {/* Column 1: API settings */}
            <div className="settings-col" style={{ gap: '15px' }}>
              <div>
                <div className="settings-auth-title" style={{ fontSize: '0.95rem', borderBottom: '1px solid rgba(0,0,0,0.05)', paddingBottom: '4px', marginBottom: '8px' }}>🎨 生图接口配置 (Image Generation)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="input-group">
                    <label>接入网址 (API Endpoint)</label>
                    <select
                      className="model-select"
                      value={['https://store.hachimi-ai.com', 'https://api-inference.modelscope.cn/v1', 'http://10.10.0.35/v1', 'https://generativelanguage.googleapis.com'].includes(apiUrl) ? apiUrl : 'custom'}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === 'custom') {
                          setApiUrl('custom-url');
                        } else {
                          setApiUrl(val);
                        }
                      }}
                      style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,248,231,0.5)', color: 'var(--text-main)' }}
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

                  <div className="input-group">
                    <label>授权密钥 (API Key) {(!apiUrl || apiUrl.includes('googleapis.com')) && <span style={{ fontSize: '0.8em', color: 'rgba(0,0,0,0.4)' }}>(由服务器托管)</span>}</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      disabled={!apiUrl || apiUrl.includes('googleapis.com')}
                      placeholder={(!apiUrl || apiUrl.includes('googleapis.com')) ? "无需填写 (服务器自动注入)" : "sk-..."}
                    />
                  </div>

                  <div className="input-group">
                    <label>生图模型 (Image Model)</label>
                    <select
                      className="model-select"
                      value={selectedModelId}
                      onChange={(e) => setSelectedModelId(e.target.value)}
                      style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,248,231,0.5)', color: 'var(--text-main)' }}
                    >
                      {AVAILABLE_MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                    {selectedModelId === 'custom' && (
                      <input
                        type="text"
                        value={customModelName}
                        onChange={(e) => setCustomModelName(e.target.value)}
                        placeholder="输入模型名称 (如 gemini-1.5-pro)"
                        style={{ marginTop: '5px' }}
                      />
                    )}
                  </div>
                </div>
              </div>

              <hr style={{ border: 'none', borderTop: '1px solid var(--border-color)', margin: '4px 0' }} />

              <div>
                <div className="settings-auth-title" style={{ fontSize: '0.95rem', borderBottom: '1px solid rgba(0,0,0,0.05)', paddingBottom: '4px', marginBottom: '8px' }}>💬 “勾勒”与炼金配置 (Chat & Alchemy)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div className="input-group">
                    <label>接入网址 (API Endpoint)</label>
                    <select
                      className="model-select"
                      value={['https://store.hachimi-ai.com', 'https://api-inference.modelscope.cn/v1', 'http://10.10.0.35/v1', 'https://generativelanguage.googleapis.com'].includes(chatSettings.apiUrl) ? chatSettings.apiUrl : 'custom'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setChatSettings(prev => ({
                          ...prev,
                          apiUrl: val === 'custom' ? 'custom-url' : val
                        }));
                      }}
                      style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,248,231,0.5)', color: 'var(--text-main)' }}
                    >
                      <option value="https://store.hachimi-ai.com">https://store.hachimi-ai.com</option>
                      <option value="https://api-inference.modelscope.cn/v1">https://api-inference.modelscope.cn/v1</option>
                      <option value="http://10.10.0.35/v1">http://10.10.0.35/v1</option>
                      <option value="https://generativelanguage.googleapis.com">https://generativelanguage.googleapis.com (默认)</option>
                      <option value="custom">自定义...</option>
                    </select>
                    {!['https://store.hachimi-ai.com', 'https://api-inference.modelscope.cn/v1', 'http://10.10.0.35/v1', 'https://generativelanguage.googleapis.com'].includes(chatSettings.apiUrl) && (
                      <input
                        type="text"
                        value={chatSettings.apiUrl === 'custom-url' ? '' : chatSettings.apiUrl}
                        onChange={(e) => {
                          const val = e.target.value;
                          setChatSettings(prev => ({ ...prev, apiUrl: val }));
                        }}
                        placeholder="输入自定义 API 地址"
                        style={{ marginTop: '5px' }}
                      />
                    )}
                  </div>

                  <div className="input-group">
                    <label>授权密钥 (API Key) {(!chatSettings.apiUrl || chatSettings.apiUrl.includes('googleapis.com')) && <span style={{ fontSize: '0.8em', color: 'rgba(0,0,0,0.4)' }}>(由服务器托管)</span>}</label>
                    <input
                      type="password"
                      value={chatSettings.apiKey}
                      onChange={(e) => {
                        const val = e.target.value;
                        setChatSettings(prev => ({ ...prev, apiKey: val }));
                      }}
                      disabled={!chatSettings.apiUrl || chatSettings.apiUrl.includes('googleapis.com')}
                      placeholder={(!chatSettings.apiUrl || chatSettings.apiUrl.includes('googleapis.com')) ? "无需填写 (服务器自动注入)" : "sk-..."}
                    />
                  </div>

                  <div className="input-group">
                    <label>对话模型 (Chat Model)</label>
                    <select
                      className="model-select"
                      value={['gpt5-4', 'gpt5-5', 'Qwen3_6', 'deepseek-ai/DeepSeek-V4-Flash'].includes(chatSettings.model) ? chatSettings.model : 'custom'}
                      onChange={(e) => {
                        const val = e.target.value;
                        setChatSettings(prev => ({
                          ...prev,
                          model: val === 'custom' ? 'custom-model-id' : val
                        }));
                      }}
                      style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'rgba(255,248,231,0.5)', color: 'var(--text-main)' }}
                    >
                      <option value="gpt5-4">gpt5-4</option>
                      <option value="gpt5-5">gpt5-5</option>
                      <option value="Qwen3_6">Qwen3_6</option>
                      <option value="deepseek-ai/DeepSeek-V4-Flash">deepseek-ai/DeepSeek-V4-Flash</option>
                      <option value="custom">自定义...</option>
                    </select>
                    {!['gpt5-4', 'gpt5-5', 'Qwen3_6', 'deepseek-ai/DeepSeek-V4-Flash'].includes(chatSettings.model) && (
                      <input
                        type="text"
                        value={chatSettings.model === 'custom-model-id' ? '' : chatSettings.model}
                        onChange={(e) => {
                          const val = e.target.value;
                          setChatSettings(prev => ({ ...prev, model: val }));
                        }}
                        placeholder="输入模型名称 (如 deepseek-chat)"
                        style={{ marginTop: '5px' }}
                      />
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Column 2: Account system */}
            <div className="settings-col">
              {currentUser ? (
                // Logged in
                <div>
                  <div className="settings-auth-title">👤 已登录账号</div>
                  <div className="settings-auth-welcome" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div><strong>昵称：</strong>{currentUser.nickname}</div>
                    <div><strong>邮箱：</strong>{currentUser.username}</div>
                    <div><strong>身份：</strong>{currentUser.role === 'admin' ? '系统管理员' : '普通用户'}</div>
                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                      {currentUser.role === 'admin' && (
                        <button className="settings-tab-btn active" onClick={() => navigate('/admin')} style={{ flex: 1, padding: '8px', textAlign: 'center' }}>
                          进入后台管理
                        </button>
                      )}
                      <button className="settings-tab-btn" onClick={logout} style={{ flex: 1, border: '1px solid var(--border-color)', padding: '8px', textAlign: 'center' }}>
                        退出登录
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                // Not logged in
                <div>
                  <div className="settings-tab-headers">
                    <button
                      className={`settings-tab-btn ${authMode === 'login' ? 'active' : ''}`}
                      onClick={() => { setAuthMode('login'); setAuthError(''); }}
                    >
                      登录
                    </button>
                    <button
                      className={`settings-tab-btn ${authMode === 'register' ? 'active' : ''}`}
                      onClick={() => { setAuthMode('register'); setAuthError(''); }}
                    >
                      注册
                    </button>
                    <button
                      className={`settings-tab-btn ${authMode === 'recovery' ? 'active' : ''}`}
                      onClick={() => { setAuthMode('recovery'); setAuthError(''); setRecoverySuccess(''); }}
                    >
                      找回密码
                    </button>
                  </div>

                  {authMode === 'login' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div className="input-group">
                        <label>邮箱</label>
                        <input
                          type="email"
                          value={authForm.username}
                          onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })}
                          placeholder="请输入您的邮箱"
                        />
                      </div>
                      <div className="input-group">
                        <label>密码</label>
                        <input
                          type="password"
                          value={authForm.password}
                          onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                          placeholder="请输入密码"
                        />
                      </div>
                      {authError && <div className="error-message" style={{ color: 'var(--primary-text)', fontSize: '0.85rem' }}>{authError}</div>}
                      <button className="settings-tab-btn active" onClick={submitAuth} style={{ width: '100%', padding: '10px', marginTop: '5px' }}>
                        立即登录
                      </button>
                    </div>
                  )}

                  {authMode === 'register' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div className="input-group">
                        <label>邮箱</label>
                        <input
                          type="email"
                          value={authForm.username}
                          onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })}
                          placeholder="请输入有效的邮箱地址"
                        />
                      </div>
                      <div className="input-group">
                        <label>昵称 (可选)</label>
                        <input
                          type="text"
                          value={authForm.nickname}
                          onChange={(e) => setAuthForm({ ...authForm, nickname: e.target.value })}
                          placeholder="公开显示昵称"
                        />
                      </div>
                      <div className="input-group">
                        <label>密码</label>
                        <input
                          type="password"
                          value={authForm.password}
                          onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
                          placeholder="至少需要 6 位"
                        />
                      </div>
                      <div className="input-group">
                        <label>密保问题</label>
                        <select
                          value={authForm.securityQuestion || ''}
                          onChange={(e) => setAuthForm({ ...authForm, securityQuestion: e.target.value })}
                          style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', background: '#fff', color: '#000' }}
                        >
                          <option value="">-- 请选择密保问题 (用于找回密码) --</option>
                          <option value="pet">我最喜欢的宠物名字是什么？</option>
                          <option value="food">我最喜欢的食物是什么？</option>
                          <option value="city">我的出生城市是哪里？</option>
                          <option value="mother">我母亲的姓名是什么？</option>
                        </select>
                      </div>
                      <div className="input-group">
                        <label>密保答案</label>
                        <input
                          type="text"
                          value={authForm.securityAnswer || ''}
                          onChange={(e) => setAuthForm({ ...authForm, securityAnswer: e.target.value })}
                          placeholder="请输入密保问题答案"
                        />
                      </div>
                      {authError && <div className="error-message" style={{ color: 'var(--primary-text)', fontSize: '0.85rem' }}>{authError}</div>}
                      <button className="settings-tab-btn active" onClick={submitAuth} style={{ width: '100%', padding: '10px', marginTop: '5px' }}>
                        注册并登录
                      </button>
                    </div>
                  )}

                  {authMode === 'recovery' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div className="input-group">
                        <label>注册邮箱</label>
                        <input
                          type="email"
                          value={recoveryForm.username}
                          onChange={(e) => setRecoveryForm({ ...recoveryForm, username: e.target.value })}
                          placeholder="请输入注册时填写的邮箱"
                        />
                      </div>
                      <div className="input-group">
                        <label>密保问题</label>
                        <select
                          value={recoveryForm.securityQuestion || ''}
                          onChange={(e) => setRecoveryForm({ ...recoveryForm, securityQuestion: e.target.value })}
                          style={{ width: '100%', padding: '8px', borderRadius: '8px', border: '1px solid var(--border-color)', background: '#fff', color: '#000' }}
                        >
                          <option value="">-- 请选择您的密保问题 --</option>
                          <option value="pet">我最喜欢的宠物名字是什么？</option>
                          <option value="food">我最喜欢的食物是什么？</option>
                          <option value="city">我的出生城市是哪里？</option>
                          <option value="mother">我母亲的姓名是什么？</option>
                        </select>
                      </div>
                      <div className="input-group">
                        <label>密保答案</label>
                        <input
                          type="text"
                          value={recoveryForm.securityAnswer}
                          onChange={(e) => setRecoveryForm({ ...recoveryForm, securityAnswer: e.target.value })}
                          placeholder="请输入您的密保答案"
                        />
                      </div>
                      <div className="input-group">
                        <label>设置新密码</label>
                        <input
                          type="password"
                          value={recoveryForm.newPassword}
                          onChange={(e) => setRecoveryForm({ ...recoveryForm, newPassword: e.target.value })}
                          placeholder="新密码至少需要 6 位"
                        />
                      </div>
                      {authError && <div className="error-message" style={{ color: 'var(--primary-text)', fontSize: '0.85rem' }}>{authError}</div>}
                      {recoverySuccess && <div className="success-message" style={{ color: 'green', fontSize: '0.85rem', fontWeight: 'bold' }}>{recoverySuccess}</div>}
                      <button className="settings-tab-btn active" onClick={submitRecovery} style={{ width: '100%', padding: '10px', marginTop: '5px' }}>
                        重置密码
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}



      <main className="main-content">


        {/* Top-level Tab Navigation */}
        <div className="top-tabs">
          <button
            className={`top-tab ${activeTab === 'create' ? 'active' : ''}`}
            onClick={() => setActiveTab('create')}
          >
            创作
          </button>
          <button
            className={`top-tab ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
          >
            印记
          </button>
          <button
            className={`top-tab ${activeTab === 'plaza' ? 'active' : ''}`}
            onClick={() => setActiveTab('plaza')}
          >
            共振
          </button>
        </div>

        {/* Create Tab Content */}
        {activeTab === 'create' && (
          <>
            {/* Mode Switch */}
            <div className="mode-switch">
              <button
                className={`mode-btn ${mode === 'text2img' ? 'active' : ''}`}
                onClick={() => setMode('text2img')}
              >
                文生图
              </button>
              <button
                className={`mode-btn ${mode === 'img2img' ? 'active' : ''}`}
                onClick={() => setMode('img2img')}
              >
                图生图
              </button>
            </div>

            <div className="card input-section">
              {/* Image Upload for img2img mode */}
              {mode === 'img2img' && (
                <div className="upload-zone-wrapper">
                  <label>上传参考图片</label>
                  {!uploadedImage ? (
                    <label className="upload-zone">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        hidden
                      />
                      <span>点击上传参考图片</span>
                    </label>
                  ) : (
                    <div className="image-preview-wrapper">
                      <img src={uploadedImage.preview} alt="Uploaded" className="image-preview" />
                      <button className="remove-btn" onClick={removeUploadedImage}>删除</button>
                    </div>
                  )}
                </div>
              )}

              <div className="input-label-row">
                <label htmlFor="prompt-input">
                  {mode === 'img2img' ? '描述你想要的变化' : '描述你想要的图片'}
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    className={`alchemy-btn ${isRefining ? 'loading' : ''}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={refinePrompt}
                    disabled={isRefining}
                    title="瞬间让 AI 帮你写提示词"
                  >
                    {isRefining ? '炼金中...' : '快速炼金 ✨'}
                  </button>
                  <button
                    className="manage-btn"
                    style={{ background: 'var(--secondary)', color: 'white', border: 'none' }}
                    onClick={() => navigate('/assistant')}
                    title="让 AI 引导你完善细节"
                  >
                    提示词助手
                  </button>
                </div>
              </div>

              {/* 提示词模板区域 */}
              <div className="feature-section">
                <div className="feature-header">
                  <div
                    className="feature-toggle"
                    onClick={() => setShowTemplates(!showTemplates)}
                  >
                    <span className="toggle-icon">{showTemplates ? '[收起]' : '[展开]'}</span>
                    <span className="feature-label">提示词模板</span>
                  </div>
                  {showTemplates && (
                    <button
                      className="manage-btn"
                      onClick={() => setShowTemplateModal(true)}
                      title="管理模板"
                    >
                      管理
                    </button>
                  )}
                </div>

                {showTemplates && (
                  <div className="template-bar">
                    <select
                      className="template-select"
                      onChange={(e) => {
                        const id = e.target.value
                        if (!id) return
                        const allTemplates = [...DEFAULT_TEMPLATES, ...customTemplates]
                        // 找到模板（注意类型转换）
                        const template = allTemplates.find(t => t.id.toString() === id.toString())
                        if (template) applyTemplate(template)
                        e.target.value = ''
                      }}
                    >
                      <option value="">选择模板...</option>
                      <optgroup label="预设模板">
                        {DEFAULT_TEMPLATES.filter(t => !hiddenTemplates.includes(t.id)).map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </optgroup>
                      {customTemplates.length > 0 && (
                        <optgroup label="我的模板">
                          {customTemplates.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                    <button
                      className="save-template-btn"
                      onClick={() => {
                        setNewTemplateName('')
                        setShowTemplateModal(true)
                      }}
                      title="添加/管理模板"
                    >
                      ➕
                    </button>
                  </div>
                )}
              </div>

              <textarea
                ref={textareaRef}
                id="prompt-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={mode === 'img2img' ? '把这张图片变成卡通风格...' : 'A futuristic city with flying cars...'}
                rows={3}
              />

              {/* 风格预设区域 */}
              <div className="feature-section">
                <div className="feature-header">
                  <div
                    className="feature-toggle"
                    onClick={() => setShowStyles(!showStyles)}
                  >
                    <span className="toggle-icon">{showStyles ? '[收起]' : '[展开]'}</span>
                    <span className="feature-label">风格预设</span>
                  </div>
                  {showStyles && (
                    <button
                      className="manage-btn"
                      onClick={() => setShowStyleModal(true)}
                      title="管理风格"
                    >
                      管理
                    </button>
                  )}
                </div>

                {showStyles && (
                  <div className="style-presets">
                    <div className="style-tags">
                      {/* 渲染所有非隐藏的风格 */}
                      {[...STYLE_PRESETS, ...customStyles]
                        .filter(s => !hiddenStyles.includes(s.id))
                        .map(style => (
                          <button
                            key={style.id}
                            className={`style-tag ${selectedStyle === style.id ? 'active' : ''}`}
                            onClick={() => toggleStyle(style.id)}
                          >
                            {style.label}
                          </button>
                        ))
                      }
                      <button
                        className="style-tag add-style"
                        onClick={() => setShowStyleModal(true)}
                      >
                        添加
                      </button>
                    </div>
                  </div>
                )}
              </div>



              {/* 图片比例选择 */}
              {/* Pictures Ratio and Quality Selection */}
              {/* Pictures Ratio and Quality Selection */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                <div className="aspect-ratio-selector">
                  <span className="ratio-label" style={{ minWidth: '40px' }}>比例</span>
                  <div className="ratio-options">
                    {ASPECT_RATIOS.map(ratio => (
                      <button
                        key={ratio.id}
                        className={`ratio-btn ${aspectRatio === ratio.id ? 'active' : ''}`}
                        onClick={() => setAspectRatio(ratio.id)}
                      >
                        {ratio.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="aspect-ratio-selector">
                  <span className="ratio-label" style={{ minWidth: '40px' }}>画质</span>
                  <div className="ratio-options">
                    {QUALITY_LEVELS.map(q => (
                      <button
                        key={q.id}
                        className={`ratio-btn ${quality === q.id ? 'active' : ''}`}
                        onClick={() => setQuality(q.id)}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <button
                className="generate-btn"
                onClick={generateImage}
                disabled={loading || !prompt || (mode === 'img2img' && !uploadedImage)}
              >
                {loading ? '生成中...' : '生成图片'}
              </button>
            </div>

            {error && <div className="error-message">{error}</div>}


            {imageUrl && (
              <div className="card result-section">
                <img
                  src={imageUrl}
                  alt="Generated result"
                  className="generated-image"
                  style={{ aspectRatio: aspectRatio.replace(':', '/') }}
                />
                <div className="action-buttons" style={{ marginTop: '16px' }}>
                  <a
                    href={imageUrl}
                    download={`legend-${Date.now()}.jpg`}
                    className="action-btn" // Use action-btn style from new CSS
                    target="_blank"
                    rel="noreferrer"
                    style={{ flex: 1, textDecoration: 'none', justifyContent: 'center' }}
                  >
                    下载图片
                  </a>
                </div>
              </div>
            )}

            {/* History Gallery (Moved to History Tab) */}
          </>
        )}

        {/* History Tab Content (Separated) */}
        {activeTab === 'history' && (
          <div className="history-section" style={{ marginTop: 0 }}>
            <h3>历史画廊</h3>
            <p className="negentropy-dynamic" style={{ marginBottom: '24px' }}>
              在混沌的数据流中，截取逆熵的瞬间
            </p>

            {history.length === 0 ? (
              <div className="empty-plaza" style={{ textAlign: 'center', padding: '40px', color: '#999' }}>
                <p>还没有历史记录，快去创作吧！✨</p>
              </div>
            ) : (
              <div className="history-grid">
                {history.map((item) => (
                  <div key={item.id} className="history-item">
                    <img
                      src={item.url}
                      alt={item.prompt}
                      className="history-thumbnail"
                      onClick={() => {
                        reworkHistoryImage(item)
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                      }}
                    />
                    <div className="history-actions">
                      <button
                        className="history-action-btn delete"
                        onClick={(e) => {
                          e.stopPropagation()
                          removeFromHistory(item.id)
                        }}
                        title="删除"
                      >
                        删除
                      </button>
                      <button
                        className="history-action-btn rework"
                        onClick={(e) => {
                          e.stopPropagation()
                          reworkHistoryImage(item)
                        }}
                        title="返工 (图生图)"
                      >
                        返工
                      </button>
                      <button
                        className="history-action-btn share"
                        onClick={(e) => {
                          e.stopPropagation()
                          openShareModal(item)
                        }}
                        disabled={sharingId === item.id}
                        title="分享到广场"
                      >
                        {sharingId === item.id ? '...' : '分享'}
                      </button>
                      <a
                        href={item.url}
                        download={`legend-${item.id}.jpg`}
                        className="history-action-btn download"
                        onClick={(e) => e.stopPropagation()}
                        title="下载"
                      >
                        下载
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {history.length >= 20 && (
              <p className="history-limit-hint">仅保存最近 20 张图片以节省空间</p>
            )}
          </div>
        )}


        {/* Plaza Tab Content */}
        {activeTab === 'plaza' && (
          <div className="plaza-section">
            <h3>共振</h3>
            <p className="plaza-slogan">每一份构思，必有回响</p>
            <p className="plaza-hint">这里展示大家分享的作品，快去创作并分享你的作品吧！</p>
            <div className="plaza-filter" role="group" aria-label="共振筛选">
              <button
                className={`plaza-filter-btn ${plazaFilter === 'all' ? 'active' : ''}`}
                onClick={() => setPlazaFilter('all')}
                type="button"
              >
                全部
              </button>
              <button
                className={`plaza-filter-btn ${plazaFilter === 'featured' ? 'active' : ''}`}
                onClick={() => setPlazaFilter('featured')}
                type="button"
              >
                波源
              </button>
            </div>

            {loadingGallery ? (
              <div className="loading-text">加载中...</div>
            ) : publicGallery.length === 0 ? (
              <div className="empty-plaza">
                <p>还没有作品，成为第一个分享的人吧！</p>
              </div>
            ) : visiblePublicGallery.length === 0 ? (
              <div className="empty-plaza">
                <p>还没有波源作品</p>
              </div>
            ) : (
              <div className="plaza-grid">
                {visiblePublicGallery.map((item) => (
                  <div key={item.id} className="plaza-item" onClick={() => setSelectedGalleryItem(item)} style={{ cursor: 'pointer' }}>
                    <img
                      src={`/uploads/${item.filename}`}
                      alt={item.prompt}
                      className="plaza-thumbnail"
                    />
                    {item.isFeatured && <div className="plaza-featured-badge">波源</div>}
                    {item.deviceId === deviceId && (
                      <button
                        className="plaza-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          deletePlazaItem(item.id);
                        }}
                        title="删除我的分享"
                      >
                        删除
                      </button>
                    )}
                    <div className="plaza-info">
                      <div className="plaza-author">
                        <span className="author-avatar" style={{
                          background: `hsl(${((item.author || '匿名').charCodeAt(0) || 0) * 137 % 360}, 70%, 60%)`
                        }}>
                          {(item.author || '匿名').charAt(0).toUpperCase()}
                        </span>
                        {item.author || '匿名'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Share Modal */}
      {
        showShareModal && (
          <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>分享到共振</h3>

              <div className="modal-field">
                <label>您的昵称</label>
                <input
                  type="text"
                  value={nickname}
                  onChange={(e) => saveNickname(e.target.value)}
                  placeholder="输入昵称（可选）"
                  maxLength={20}
                />
              </div>

              <div className="modal-field">
                <label>分享感悟</label>
                <textarea
                  value={shareCaption}
                  onChange={(e) => setShareCaption(e.target.value)}
                  placeholder="写点想法或感悟吧~（可选）"
                  maxLength={100}
                  rows={2}
                />
              </div>

              <label className="modal-checkbox">
                <input
                  type="checkbox"
                  checked={shareWithNickname}
                  onChange={(e) => setShareWithNickname(e.target.checked)}
                />
                在共振显示我的昵称
              </label>

              <div className="modal-buttons">
                <button className="modal-btn cancel" onClick={() => setShowShareModal(false)}>
                  取消
                </button>
                <button className="modal-btn confirm" onClick={confirmShare}>
                  确认分享
                </button>
              </div>
            </div>
          </div>
        )
      }

      {/* Gallery Item Details Modal */}
      {selectedGalleryItem && (
        <div className="modal-overlay" onClick={() => setSelectedGalleryItem(null)}>
          <div className="modal-content prompt-detail-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', width: '90%', borderRadius: '16px', padding: '24px' }}>
            <h3 style={{ marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>✨ 作品详情</h3>
            
            {/* Image Container */}
            <div style={{ position: 'relative', width: '100%', borderRadius: '12px', overflow: 'hidden', marginBottom: '16px', background: '#000', display: 'flex', justifyContent: 'center' }}>
              <img
                src={`/uploads/${selectedGalleryItem.filename}`}
                alt={selectedGalleryItem.prompt}
                style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }}
              />
            </div>

            {/* Creator Information */}
            <div className="plaza-author" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <strong style={{ fontSize: '0.9rem' }}>生成者：</strong>
              <span className="author-avatar" style={{
                background: `hsl(${((selectedGalleryItem.author || '匿名').charCodeAt(0) || 0) * 137 % 360}, 70%, 60%)`,
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
                {(selectedGalleryItem.author || '匿名').charAt(0).toUpperCase()}
              </span>
              <span style={{ fontSize: '0.9rem', fontWeight: 'bold' }}>{selectedGalleryItem.author || '匿名'}</span>
            </div>

            {/* Prompt Block */}
            {selectedGalleryItem.prompt && (
              <div style={{ marginBottom: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <strong style={{ fontSize: '0.9rem' }}>提示词 (Prompt)：</strong>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="settings-tab-btn active"
                      style={{ fontSize: '0.75rem', padding: '4px 8px', height: '28px', display: 'flex', alignItems: 'center' }}
                      onClick={() => {
                        navigator.clipboard.writeText(selectedGalleryItem.prompt);
                        alert('提示词已复制到剪贴板！');
                      }}
                    >
                      复制
                    </button>
                    <button
                      className="settings-tab-btn active"
                      style={{ fontSize: '0.75rem', padding: '4px 8px', height: '28px', display: 'flex', alignItems: 'center', background: 'var(--primary)', borderColor: 'var(--primary-text)' }}
                      onClick={() => {
                        setPrompt(selectedGalleryItem.prompt);
                        setSelectedGalleryItem(null);
                        setActiveTab('create');
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      使用提示词
                    </button>
                  </div>
                </div>
                <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem', wordBreak: 'break-all', whiteSpace: 'pre-wrap', color: 'var(--text-main)', textAlign: 'left' }}>
                  {selectedGalleryItem.prompt}
                </div>
              </div>
            )}

            {/* Caption Block */}
            {selectedGalleryItem.caption && (
              <div style={{ marginBottom: '16px' }}>
                <strong style={{ fontSize: '0.9rem' }}>分享感悟：</strong>
                <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,0.03)', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-sub)', textAlign: 'left' }}>
                  {selectedGalleryItem.caption}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
              <button className="modal-btn confirm" onClick={() => setSelectedGalleryItem(null)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )
      }

      {/* Template Management Modal */}
      {
        showTemplateModal && (
          <div className="modal-overlay" onClick={() => setShowTemplateModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>📋 管理提示词模板</h3>

              <div className="modal-section">
                <h4>新建模板</h4>
                <div className="modal-field">
                  <input
                    type="text"
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="模板名称"
                    maxLength={20}
                  />
                </div>
                <div className="template-preview">{prompt || '（当前提示词为空）'}</div>
                <button
                  className="modal-btn confirm"
                  onClick={addCustomTemplate}
                  disabled={!prompt.trim() || !newTemplateName.trim()}
                  style={{ marginTop: 10 }}
                >
                  保存当前提示词为模板
                </button>
              </div>

              <div className="modal-section list-section">
                <h4>已有模板</h4>
                <div className="manage-list">
                  {/* 预设模板 - 只显示未隐藏的 */}
                  {DEFAULT_TEMPLATES.filter(t => !hiddenTemplates.includes(t.id)).map(t => (
                    <div key={t.id} className="manage-item">
                      <span className="item-name">{t.name} <span className="tag">预设</span></span>
                      <button
                        className="icon-btn delete"
                        onClick={() => toggleHiddenTemplate(t.id)}
                        title="删除"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                  {/* 自定义模板 */}
                  {customTemplates.map(t => (
                    <div key={t.id} className="manage-item">
                      <span className="item-name">{t.name}</span>
                      <button
                        className="icon-btn delete"
                        onClick={() => deleteCustomTemplate(t.id)}
                        title="删除"
                      >
                        �️
                      </button>
                    </div>
                  ))}
                </div>

                {/* 恢复已删除的预设 */}
                {hiddenTemplates.length > 0 && (
                  <div className="restore-section">
                    <h4>恢复已删除预设</h4>
                    <div className="manage-list">
                      {DEFAULT_TEMPLATES.filter(t => hiddenTemplates.includes(t.id)).map(t => (
                        <div key={t.id} className="manage-item restore-item">
                          <span className="item-name hidden-item">{t.name}</span>
                          <button
                            className="icon-btn restore"
                            onClick={() => toggleHiddenTemplate(t.id)}
                            title="恢复"
                          >
                            ♻️
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button className="modal-btn cancel width-100" onClick={() => setShowTemplateModal(false)}>
                关闭
              </button>
            </div>
          </div>
        )
      }

      {/* Style Management Modal */}
      {
        showStyleModal && (
          <div className="modal-overlay" onClick={() => setShowStyleModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>🎨 管理风格预设</h3>

              <div className="modal-section">
                <h4>新建风格</h4>
                <div className="modal-field">
                  <input
                    type="text"
                    value={newStyleLabel}
                    onChange={(e) => setNewStyleLabel(e.target.value)}
                    placeholder="风格名称 (如: 赛博朋克)"
                    maxLength={10}
                  />
                </div>
                <div className="modal-field">
                  <input
                    type="text"
                    value={newStyleSuffix}
                    onChange={(e) => setNewStyleSuffix(e.target.value)}
                    placeholder="提示词后缀 (如: , cyberpunk style...)"
                  />
                </div>
                <button
                  className="modal-btn confirm"
                  onClick={addCustomStyle}
                  disabled={!newStyleLabel.trim() || !newStyleSuffix.trim()}
                  style={{ marginTop: 10 }}
                >
                  添加新风格
                </button>
              </div>

              <div className="modal-section list-section">
                <h4>已有风格</h4>
                <div className="manage-list">
                  {/* 预设风格 - 只显示未隐藏的 */}
                  {STYLE_PRESETS.filter(s => !hiddenStyles.includes(s.id)).map(s => (
                    <div key={s.id} className="manage-item">
                      <span className="item-name">{s.label} <span className="tag">预设</span></span>
                      <button
                        className="icon-btn delete"
                        onClick={() => toggleHiddenStyle(s.id)}
                        title="删除"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                  {/* 自定义风格 */}
                  {customStyles.map(s => (
                    <div key={s.id} className="manage-item">
                      <span className="item-name">{s.label}</span>
                      <button
                        className="icon-btn delete"
                        onClick={() => deleteCustomStyle(s.id)}
                        title="删除"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>

                {/* 恢复已删除的预设 */}
                {hiddenStyles.length > 0 && (
                  <div className="restore-section">
                    <h4>恢复已删除预设</h4>
                    <div className="manage-list">
                      {STYLE_PRESETS.filter(s => hiddenStyles.includes(s.id)).map(s => (
                        <div key={s.id} className="manage-item restore-item">
                          <span className="item-name hidden-item">{s.label}</span>
                          <button
                            className="icon-btn restore"
                            onClick={() => toggleHiddenStyle(s.id)}
                            title="恢复"
                          >
                            恢复
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button className="modal-btn cancel width-100" onClick={() => setShowStyleModal(false)}>
                关闭
              </button>
            </div>
          </div>
        )
      }

      <footer className="app-footer">
        采用最强的生图模型
      </footer>
    </div >
  )
}

export default Home
