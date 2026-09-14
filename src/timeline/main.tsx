import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles/tokens.css'
import '../styles/global.css'
import { TimelinePage } from './TimelinePage'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TimelinePage />
  </StrictMode>,
)
