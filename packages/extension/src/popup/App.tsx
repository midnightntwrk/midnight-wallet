import { Routes, Route } from 'react-router-dom'
import { WelcomePage } from './pages/Welcome'

export default function App() {
  return (
    <div className="w-[360px] h-[600px] bg-white overflow-hidden">
      <Routes>
        <Route path="/" element={<WelcomePage />} />
      </Routes>
    </div>
  )
}
