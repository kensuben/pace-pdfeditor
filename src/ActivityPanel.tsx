import { useEffect, useMemo, useState } from 'react'
import { Activity, Clock3, Download, FileText, Filter, LogIn, ShieldCheck, Trash2, X } from 'lucide-react'
import { clearActivities, loadActivities, type ActivityEntry } from './activityLog'

const actionIcon = (action: string) => action.includes('auth') ? <LogIn/> : action.includes('document') || action.includes('export') ? <FileText/> : <Activity/>

export default function ActivityPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [logs, setLogs] = useState<ActivityEntry[]>(() => loadActivities(userId))
  const [filter, setFilter] = useState('all')
  useEffect(() => {
    const refresh = () => setLogs(loadActivities(userId))
    window.addEventListener('paperly-activity', refresh)
    return () => window.removeEventListener('paperly-activity', refresh)
  }, [userId])
  const visible = useMemo(() => filter === 'all' ? logs : logs.filter((x) => x.level === filter), [filter, logs])
  const exportLogs = () => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `paperly-activity-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(url)
  }
  return <div className="activity-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <aside className="activity-panel">
      <div className="activity-title"><span><ShieldCheck/> Activity log</span><button onClick={onClose}><X/></button></div>
      <p className="activity-intro">Lịch sử thao tác của tài khoản này trên thiết bị. Nội dung PDF không được ghi vào log.</p>
      <div className="activity-controls">
        <label><Filter/>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">Tất cả</option><option value="security">Bảo mật</option><option value="success">Thành công</option><option value="warning">Cảnh báo</option><option value="info">Thông tin</option></select>
        </label>
        <button onClick={exportLogs} disabled={!logs.length}><Download/> Export JSON</button>
        <button className="danger" onClick={() => { if (confirm('Xóa toàn bộ activity log trên thiết bị này?')) { clearActivities(userId); setLogs([]) } }} disabled={!logs.length}><Trash2/></button>
      </div>
      <div className="activity-list">{visible.length ? visible.map((log) => <article key={log.id} className={`activity-item ${log.level}`}>
        <div className="activity-icon">{actionIcon(log.action)}</div>
        <div><div className="activity-row"><b>{log.description}</b><time><Clock3/>{new Date(log.timestamp).toLocaleString('vi-VN')}</time></div><code>{log.action}</code>{log.metadata && <div className="metadata">{Object.entries(log.metadata).map(([k,v]) => <span key={k}>{k}: <b>{String(v)}</b></span>)}</div>}</div>
      </article>) : <div className="no-activity"><Activity/><b>Chưa có hoạt động</b><span>Các thao tác sử dụng sẽ xuất hiện tại đây.</span></div>}</div>
      <footer>{logs.length} sự kiện · Tối đa 1.000 sự kiện gần nhất</footer>
    </aside>
  </div>
}
