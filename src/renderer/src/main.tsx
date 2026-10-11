import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

// A file dropped anywhere else would navigate the window to it, replacing the
// app. Only the terminal takes file drops.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => {
    if (!e.defaultPrevented && e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'none'
    }
  })
}

createRoot(document.getElementById('root')!).render(<App />)
