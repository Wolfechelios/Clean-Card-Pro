
import { Routes, Route } from 'react-router-dom'
import CardStore from './pages/CardStore'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<CardStore />} />
    </Routes>
  )
}
