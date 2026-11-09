import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import App from './App'
import AppV1 from './legacy/AppV1'
import './styles.css'

const rawBase = import.meta.env.BASE_URL || '/'
const basename = rawBase === '/' ? '/' : rawBase.replace(/\/$/, '')

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<App initialTab="execution" />} />
        <Route path="/observabilidade" element={<App initialTab="admin" />} />
        <Route path="/v1" element={<AppV1 initialTab="execution" />} />
        <Route path="/anterior" element={<AppV1 initialTab="execution" />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
