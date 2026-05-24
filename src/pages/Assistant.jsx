import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import '../App.css'

function Assistant() {
    const navigate = useNavigate()



    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const endRef = useRef(null)
    const initialized = useRef(false)

    // Auto-scroll
    useEffect(() => {
        if (endRef.current) {
            endRef.current.scrollIntoView({ behavior: 'smooth' })
        }
    }, [messages, loading])

    // Auto-start Logic
    useEffect(() => {
        if (initialized.current) return
        initialized.current = true

        const draft = localStorage.getItem('banana_home_prompt') || '';

        if (draft.trim()) {
            // Immediate optimization start
            const initialHistory = [{ role: 'user', content: `我的初始想法是："${draft}"。\n请直接开始分析，并向我提问以完善这个提示词。` }]
            // setMessages(initialHistory) // Don't show the system-like trigger message, just show context? 
            // User prefers "Directly start". Let's show the AI's first question directly.
            // But we need to show the user *what* is being optimized.

            setMessages([{ role: 'user', content: draft }])
            triggerAI(initialHistory)
        } else {
            setMessages([
                { role: 'assistant', content: '请告诉我你想画什么？我会协助你完善细节。' }
            ])
        }
    }, [])

    const triggerAI = async (history) => {
        setLoading(true)
        try {
            let savedApiKey = ''
            let savedApiUrl = 'https://generativelanguage.googleapis.com'
            let resolvedModel = 'gpt5-4'
            try {
                const savedChatSettings = localStorage.getItem('banana_chat_api_settings')
                if (savedChatSettings) {
                    const parsed = JSON.parse(savedChatSettings)
                    savedApiKey = parsed.apiKey || ''
                    savedApiUrl = parsed.apiUrl || 'https://generativelanguage.googleapis.com'
                    resolvedModel = parsed.model || 'gpt5-4'
                }
            } catch (e) {}

            const res = await fetch('/api/alchemy-chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: history,
                    apiKey: savedApiKey,
                    apiUrl: savedApiUrl,
                    model: resolvedModel
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || 'Connection failed')

            setMessages(prev => [...prev, { role: 'assistant', content: data.content }])
        } catch (err) {
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }])
        } finally {
            setLoading(false)
        }
    }

    const handleSend = () => {
        if (!input.trim()) return
        const newMsg = { role: 'user', content: input.trim() }
        const newHistory = [...messages, newMsg]
        setMessages(newHistory)
        setInput('')
        triggerAI(newHistory)
    }

    const applyResult = (text) => {
        const match = text.match(/<final_prompt>([\s\S]*?)<\/final_prompt>/i);
        if (match && match[1]) {
            const finalPrompt = match[1].trim();
            localStorage.setItem('banana_home_prompt', finalPrompt);
            navigate('/');
        }
    }

    const cleanContent = (text) => {
        return text.replace(/<final_prompt>[\s\S]*?<\/final_prompt>/i, '').trim();
    }

    const finish = () => {
        const newMsg = { role: 'user', content: '请直接输出最终的成品提示词，不要再问问题了。请用 <final_prompt> 标签包裹。' } // System instruction hidden or shown? Better to just show "Finish" or similar in UI but send this.
        // Actually, let's just trigger it directly.
        const newHistory = [...messages, newMsg]
        setMessages(newHistory)
        triggerAI(newHistory)
    }

    return (
        <div className="assistant-page">
            <header className="assistant-header">
                <button className="nav-text-btn" onClick={() => navigate('/')}>返回</button>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="assistant-title">提示词助手</span>
                </div>
                <button className="nav-text-btn primary" onClick={finish}>立刻生成</button>
            </header>

            <div className="chat-container">
                {messages.map((msg, i) => (
                    <div key={i} className={`chat-message ${msg.role}`}>
                        <div className="message-bubble">
                            {cleanContent(msg.content)}

                            {msg.role === 'assistant' && msg.content.includes('<final_prompt>') && (
                                <div className="result-block">
                                    <div className="result-preview">
                                        {msg.content.match(/<final_prompt>([\s\S]*?)<\/final_prompt>/i)?.[1]}
                                    </div>
                                    <button
                                        className="apply-result-btn"
                                        onClick={() => applyResult(msg.content)}
                                    >
                                        使用此提示词
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {loading && (
                    <div className="chat-message assistant">
                        <div className="message-bubble loading-bubble">
                            <div className="dot-pulse"></div>
                        </div>
                    </div>
                )}
                <div ref={endRef} />
            </div>

            <div className="input-area">
                <input
                    className="chat-input"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    placeholder="输入想法..."
                    autoFocus
                />
                <button
                    className="send-btn"
                    onClick={handleSend}
                    disabled={loading || !input.trim()}
                >
                    发送
                </button>
            </div>
        </div>
    )
}

export default Assistant
