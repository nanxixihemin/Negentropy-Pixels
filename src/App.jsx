import { Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Chat from './pages/Chat'
import Assistant from './pages/Assistant'
import Admin from './pages/Admin'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/chat" element={<Chat />} />
      <Route path="/assistant" element={<Assistant />} />
      <Route path="/admin" element={<Admin />} />
    </Routes>
  )
}

export default App
