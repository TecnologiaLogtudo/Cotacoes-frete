import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const API_BASE = import.meta.env.BASE_URL
const apiUrl = (path) => `${API_BASE}api${path.startsWith('/') ? path : `/${path}`}`

function parseDate(value) {
  if (!value) return null
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return null
  return dt
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatDateTime(value) {
  const dt = parseDate(value)
  if (!dt) return '-'
  return `${pad2(dt.getDate())}/${pad2(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`
}

function buildBaseShortId(value) {
  const dt = parseDate(value)
  if (!dt) return ''
  return `${pad2(dt.getDate())}${pad2(dt.getMonth() + 1)}${dt.getFullYear()}-${pad2(dt.getHours())}${pad2(dt.getMinutes())}`
}

function uniqueShortId(baseId, usageMap) {
  if (!baseId) return ''
  const count = (usageMap.get(baseId) || 0) + 1
  usageMap.set(baseId, count)
  if (count === 1) return baseId
  return `${baseId}-${count}`
}

export default function Observabilidade() {
  const [activeTab, setActiveTab] = useState('overview_jobs')
  const [statusFilter, setStatusFilter] = useState('')
  const [summaryData, setSummaryData] = useState({ total_jobs: 0, success_jobs: 0, error_jobs: 0, running_jobs: 0 })
  const [jobs, setJobs] = useState([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [jobMetaByFullId, setJobMetaByFullId] = useState(new Map())
  const [fullIdByShortId, setFullIdByShortId] = useState(new Map())
  const [actions, setActions] = useState([])
  const [steps, setSteps] = useState([])
  const [browserLogs, setBrowserLogs] = useState([])
  const [artifactVideo, setArtifactVideo] = useState(null)
  const [actionsJobId, setActionsJobId] = useState('')
  const [stepsJobId, setStepsJobId] = useState('')
  const [artifactsJobId, setArtifactsJobId] = useState('')
  const [browserJobId, setBrowserJobId] = useState('')
  const [loading, setLoading] = useState({})
  const [toasts, setToasts] = useState([])

  function showToast(message, type = 'info') {
    const id = `${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, message, type }])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 2300)
  }

  function setBusy(key, value) {
    setLoading((prev) => ({ ...prev, [key]: value }))
  }

  const shortIdFromFullId = (fullId) => jobMetaByFullId.get(fullId)?.shortId || fullId || ''

  const resolveJobId = (value) => {
    if (!value) return ''
    if (jobMetaByFullId.has(value)) return value
    if (fullIdByShortId.has(value)) return fullIdByShortId.get(value)
    return value
  }

  const syncJobInputs = (fullId) => {
    const displayId = shortIdFromFullId(fullId)
    setActionsJobId(displayId)
    setStepsJobId(displayId)
    setArtifactsJobId(displayId)
    setBrowserJobId(displayId)
  }

  async function loadSummary() {
    const res = await fetch(apiUrl('/admin/summary'))
    if (!res.ok) {
      showToast('Falha ao carregar resumo', 'error')
      return
    }
    const data = await res.json()
    setSummaryData(data)
  }

  async function loadJobs() {
    const url = new URL(apiUrl('/admin/jobs'), window.location.origin)
    if (statusFilter) url.searchParams.set('status', statusFilter)

    const res = await fetch(url.toString())
    if (!res.ok) {
      showToast('Falha ao carregar jobs', 'error')
      return
    }

    const data = await res.json()
    const items = data.items || []
    const shortIdUsage = new Map()
    const localJobMeta = new Map()
    const localFullByShort = new Map()

    const normalized = items.map((job) => {
      const shortBase = buildBaseShortId(job.started_at)
      const shortId = uniqueShortId(shortBase, shortIdUsage) || String(job.id || '').slice(0, 8)
      localJobMeta.set(job.id, { shortId })
      localFullByShort.set(shortId, job.id)
      return { ...job, shortId }
    })

    setJobMetaByFullId(localJobMeta)
    setFullIdByShortId(localFullByShort)
    setJobs(normalized)

    if (!normalized.length) {
      setSelectedJobId('')
      syncJobInputs('')
      setActions([])
      setSteps([])
      setBrowserLogs([])
      setArtifactVideo(null)
      return
    }

    const exists = normalized.some((item) => item.id === selectedJobId)
    const selected = exists ? selectedJobId : normalized[0].id
    setSelectedJobId(selected)
    syncJobInputs(selected)
    await loadCurrentTabData(selected, activeTab)
  }

  async function loadActions(jobId) {
    if (!jobId) return
    const res = await fetch(apiUrl(`/admin/jobs/${jobId}/actions`))
    if (!res.ok) {
      showToast('Falha ao carregar acoes', 'error')
      setActions([])
      return
    }
    const data = await res.json()
    setActions(data.items || [])
  }

  async function loadSteps(jobId) {
    if (!jobId) return
    const res = await fetch(apiUrl(`/admin/jobs/${jobId}/steps`))
    if (!res.ok) {
      showToast('Falha ao carregar passos', 'error')
      setSteps([])
      return
    }
    const data = await res.json()
    setSteps(data.items || [])
  }

  async function loadArtifacts(jobId) {
    if (!jobId) return
    const res = await fetch(apiUrl(`/admin/jobs/${jobId}/artifacts`))
    if (!res.ok) {
      showToast('Falha ao carregar artefatos', 'error')
      setArtifactVideo(null)
      return
    }
    const data = await res.json()
    const firstVideo = (data.items || [])[0]
    if (!firstVideo) {
      setArtifactVideo(null)
      return
    }
    setArtifactVideo({
      src: apiUrl(`/admin/artifacts/${firstVideo.id}/file`),
      createdAt: firstVideo.created_at,
      filePath: firstVideo.file_path,
    })
  }

  async function loadBrowser(jobId) {
    if (!jobId) return
    const res = await fetch(apiUrl(`/admin/jobs/${jobId}/browser-logs`))
    if (!res.ok) {
      showToast('Falha ao carregar logs do browser', 'error')
      setBrowserLogs([])
      return
    }
    const data = await res.json()
    setBrowserLogs(data.items || [])
  }

  async function loadCurrentTabData(jobId, tab) {
    if (!jobId) return
    if (tab === 'actions') await loadActions(jobId)
    if (tab === 'steps') await loadSteps(jobId)
    if (tab === 'artifacts') await loadArtifacts(jobId)
    if (tab === 'browser') await loadBrowser(jobId)
  }

  async function selectJob(jobId) {
    if (!jobId) return
    setSelectedJobId(jobId)
    syncJobInputs(jobId)
    await loadCurrentTabData(jobId, activeTab)
  }

  async function handleRefresh() {
    setBusy('refresh', true)
    try {
      await loadSummary()
      await loadJobs()
      showToast('Painel atualizado', 'success')
    } finally {
      setBusy('refresh', false)
    }
  }

  async function handleResetLogs() {
    const password = window.prompt('Confirme a senha para apagar todos os dados de log:')
    if (password === null) return
    if (!password.trim()) {
      showToast('Senha obrigatoria para reset', 'error')
      return
    }

    setBusy('reset', true)
    try {
      const res = await fetch(apiUrl('/admin/reset-logs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        showToast(data.detail || 'Nao foi possivel resetar os logs', 'error')
        return
      }

      await loadSummary()
      await loadJobs()
      showToast('Historico de logs apagado com sucesso', 'success')
    } finally {
      setBusy('reset', false)
    }
  }

  useEffect(() => {
    loadSummary()
    loadJobs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  useEffect(() => {
    loadCurrentTabData(selectedJobId, activeTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

  return (
    <div className="observability-page">
      <div className="admin-layout">
        <aside className="admin-sidebar">
          <div className="brand">
            <div className="brand-mark">LT</div>
            <div className="brand-text">
              <div className="brand-title">LogTudo</div>
              <div className="brand-subtitle">Painel de Logs</div>
            </div>
          </div>

          <nav className="admin-tabs">
            <button className={`tab ${activeTab === 'overview_jobs' ? 'active' : ''}`} onClick={() => setActiveTab('overview_jobs')}>Visao Geral + Jobs</button>
            <button className={`tab ${activeTab === 'actions' ? 'active' : ''}`} onClick={() => setActiveTab('actions')}>Acoes Criticas</button>
            <button className={`tab ${activeTab === 'steps' ? 'active' : ''}`} onClick={() => setActiveTab('steps')}>Passos e Acoes</button>
            <button className={`tab ${activeTab === 'artifacts' ? 'active' : ''}`} onClick={() => setActiveTab('artifacts')}>Artefatos</button>
            <button className={`tab ${activeTab === 'browser' ? 'active' : ''}`} onClick={() => setActiveTab('browser')}>Logs do Browser</button>
          </nav>

          <div className="sidebar-footer">
            <Link to="/" className="btn ghost nav-link">Voltar ao Painel</Link>
          </div>
        </aside>

        <main className="admin-main">
          <header className="admin-topbar">
            <div>
              <div className="admin-title">Observabilidade</div>
              <div className="admin-subtitle">Monitoramento e auditoria das automacoes</div>
            </div>
            <div className="admin-actions">
              <button className="btn subtle" disabled={!!loading.reset} onClick={handleResetLogs}>Limpar Log</button>
              <button className="btn ghost" disabled={!!loading.refresh} onClick={handleRefresh}>Atualizar</button>
            </div>
          </header>

          {activeTab === 'overview_jobs' && (
            <section className="panel active">
              <div className="kpi-grid">
                <div className="kpi-card"><div className="kpi-label">Total Jobs</div><div className="kpi-value">{summaryData.total_jobs ?? 0}</div></div>
                <div className="kpi-card"><div className="kpi-label">Sucessos</div><div className="kpi-value">{summaryData.success_jobs ?? 0}</div></div>
                <div className="kpi-card"><div className="kpi-label">Erros</div><div className="kpi-value">{summaryData.error_jobs ?? 0}</div></div>
                <div className="kpi-card"><div className="kpi-label">Em Execucao</div><div className="kpi-value">{summaryData.running_jobs ?? 0}</div></div>
              </div>

              <div className="panel-header mt-16">
                <h2>Jobs / Sessoes</h2>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">Todos</option>
                  <option value="running">Running</option>
                  <option value="completed">Completed</option>
                  <option value="error">Error</option>
                  <option value="stopped">Stopped</option>
                </select>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Status</th>
                      <th>Usuario</th>
                      <th>IP</th>
                      <th>Data/Hora</th>
                      <th>Duracao (s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.length === 0 && <tr><td colSpan="6" className="table-empty">Nenhum job encontrado para o filtro atual.</td></tr>}
                    {jobs.map((j) => (
                      <tr key={j.id} className={`jobs-row ${selectedJobId === j.id ? 'active' : ''}`} onClick={() => selectJob(j.id)}>
                        <td>{j.shortId || j.id}</td>
                        <td>{j.status}</td>
                        <td>{j.username || '-'}</td>
                        <td>{j.ip || '-'}</td>
                        <td>{formatDateTime(j.started_at)}</td>
                        <td>{j.duration_sec ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'actions' && (
            <section className="panel active">
              <div className="panel-header">
                <h2>Acoes Criticas</h2>
                <input type="text" value={actionsJobId} onChange={(e) => setActionsJobId(e.target.value)} placeholder="Job ID" />
                <button className="btn" onClick={async () => { const id = resolveJobId(actionsJobId) || selectedJobId; await selectJob(id); await loadActions(id) }}>Carregar</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Acao</th><th>Ator</th><th>IP</th><th>Data</th></tr></thead>
                  <tbody>
                    {actions.length === 0 && <tr><td colSpan="4" className="table-empty">Nenhuma acao encontrada para este job.</td></tr>}
                    {actions.map((a, idx) => <tr key={`${idx}-${a.timestamp || ''}`}><td>{a.action_type}</td><td>{a.actor || '-'}</td><td>{a.ip || '-'}</td><td>{formatDateTime(a.timestamp)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'steps' && (
            <section className="panel active">
              <div className="panel-header">
                <h2>Passos e Acoes</h2>
                <input type="text" value={stepsJobId} onChange={(e) => setStepsJobId(e.target.value)} placeholder="Job ID" />
                <button className="btn" onClick={async () => { const id = resolveJobId(stepsJobId) || selectedJobId; await selectJob(id); await loadSteps(id) }}>Carregar</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Passo</th><th>Status</th><th>Inicio</th><th>Fim</th><th>Meta</th></tr></thead>
                  <tbody>
                    {steps.length === 0 && <tr><td colSpan="5" className="table-empty">Nenhum passo encontrado para este job.</td></tr>}
                    {steps.map((s, idx) => <tr key={`${idx}-${s.name || ''}`}><td>{s.name}</td><td>{s.status}</td><td>{formatDateTime(s.started_at)}</td><td>{formatDateTime(s.ended_at)}</td><td>{s.metadata ? JSON.stringify(s.metadata) : '-'}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'artifacts' && (
            <section className="panel active">
              <div className="panel-header">
                <h2>Artefatos (Video)</h2>
                <input type="text" value={artifactsJobId} onChange={(e) => setArtifactsJobId(e.target.value)} placeholder="Job ID" />
                <button className="btn" onClick={async () => { const id = resolveJobId(artifactsJobId) || selectedJobId; await selectJob(id); await loadArtifacts(id) }}>Carregar</button>
              </div>

              {!artifactVideo && <div className="table-empty">Nenhum video encontrado para este job.</div>}

              {artifactVideo && (
                <div className="artifact-video-section">
                  <h3>Video do Artefato</h3>
                  <video className="artifact-video-player" controls preload="metadata" src={artifactVideo.src} />
                  <a className="artifact-video-open-link" href={artifactVideo.src} target="_blank" rel="noopener noreferrer">Abrir video em nova aba</a>
                  <div className="admin-subtitle">{artifactVideo.filePath} {artifactVideo.createdAt ? `| ${formatDateTime(artifactVideo.createdAt)}` : ''}</div>
                </div>
              )}
            </section>
          )}

          {activeTab === 'browser' && (
            <section className="panel active">
              <div className="panel-header">
                <h2>Logs do Browser</h2>
                <input type="text" value={browserJobId} onChange={(e) => setBrowserJobId(e.target.value)} placeholder="Job ID" />
                <button className="btn" onClick={async () => { const id = resolveJobId(browserJobId) || selectedJobId; await selectJob(id); await loadBrowser(id) }}>Carregar</button>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Nivel</th><th>Tipo</th><th>Mensagem</th><th>URL</th><th>Data</th></tr></thead>
                  <tbody>
                    {browserLogs.length === 0 && <tr><td colSpan="5" className="table-empty">Nenhum log de browser encontrado para este job.</td></tr>}
                    {browserLogs.map((l, idx) => <tr key={`${idx}-${l.timestamp || ''}`}><td>{l.level}</td><td>{l.type}</td><td>{l.message}</td><td>{l.url || '-'}</td><td>{formatDateTime(l.timestamp)}</td></tr>)}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </main>
      </div>

      <div className="toast-root">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast show ${toast.type}`}>{toast.message}</div>
        ))}
      </div>
    </div>
  )
}
