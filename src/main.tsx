import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/hzd.css'
import './styles/research.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
