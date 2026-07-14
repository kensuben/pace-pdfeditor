import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './auth-styles.css'
import './pace-theme.css'
import './pace-fixes.css'
import './ocr-styles.css'
import './text-format.css'
import './brand-fixes.css'
import './document-tools.css'
import './inline-text-editor.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
