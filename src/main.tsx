import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// Self-hosted typefaces — no third-party font requests at runtime.
import '@fontsource/source-serif-4/600.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'

import './styles/tokens.css'
import './styles/base.css'
import { App } from './App'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root element #root was not found.')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
