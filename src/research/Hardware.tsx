import { useRef, useState } from 'react'
import { ArrowDown, Film, Maximize2 } from 'lucide-react'
import { assetUrl } from '../lib/assetUrl'
import { DataState, Tabs, useJson } from './shared'

type Video = { id: string; group: string; src: string; poster: string; label: string; duration: number; width: number; height: number; source_name: string }
const GROUPS = [
  { value: 'forward', label: 'Forward & reverse' }, { value: 'lateral', label: 'Lateral' },
  { value: 'turning', label: 'Turning' }, { value: 'cadence', label: 'Gait period' },
]

function Recording({ video, featured = false }: { video: Video; featured?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  return <figure className={`recording ${featured ? 'recording-featured' : ''}`}>
    <div className="recording-media">
      <video ref={ref} src={assetUrl(video.src)} poster={assetUrl(video.poster)} controls muted playsInline preload="metadata"
        aria-label={video.label} onPlay={() => {
          document.querySelectorAll<HTMLVideoElement>('#hardware video').forEach(other => { if (other !== ref.current) other.pause() })
        }} />
      <button className="video-expand" aria-label={`Fullscreen ${video.label}`} title="Fullscreen" onClick={() => void ref.current?.requestFullscreen()}><Maximize2 size={16}/></button>
    </div>
    <figcaption><span>{video.label}</span><span className="recording-time">{Math.round(video.duration)} s</span></figcaption>
  </figure>
}

export function Hardware() {
  const request = useJson<{ videos: Video[] }>('hzd/hardware/manifest.json')
  const [group, setGroup] = useState('forward')
  const [speed, setSpeed] = useState('0.4')
  const all = request.data?.videos.filter(video => video.group === group) || []
  const videos = group === 'forward' ? all.filter(video => video.source_name.startsWith(`vx_${speed === '0.4' ? '04' : speed === '0.8' ? '08' : '1'}_`)) : all
  return <section id="hardware" className="hardware-band">
    <div className="page-width">
      <div className="hardware-heading"><div><span className="live-dot"/><span>REAL-ROBOT EXPERIMENTS</span></div><a href="#evidence">Experimental evidence <ArrowDown size={15}/></a></div>
      <div className="hardware-toolbar"><Tabs label="Hardware experiments" options={GROUPS} value={group} onChange={value => {
        document.querySelectorAll<HTMLVideoElement>('#hardware video').forEach(video => video.pause())
        setGroup(value)
      }}/><div className="hardware-policy">HZD Orbit-Tube <span>Unitree G1 / 29 DoF</span></div></div>
      {group === 'forward' && <div className="hardware-speeds"><span>Command magnitude</span><Tabs label="Forward speed" options={['0.4', '0.8', '1.0'].map(value => ({ value, label: `${value} m/s` }))} value={speed} onChange={setSpeed}/></div>}
      {!request.data ? <DataState {...request}/> : <div className={`recordings-grid ${videos.length === 2 ? 'recordings-pair' : ''}`}>{videos.map(video => <Recording key={video.id} video={video} featured={videos.length === 2}/>)}</div>}
      <div className="hardware-footnote"><p>Commanded values, not measured velocities. Original lab footage, including visible operator contact.</p><span>{request.data?.videos.length || 15} recordings</span></div>
      <div id="recordings-pending" className="recordings-pending"><div><Film size={21}/><div><h3>Variable torso height</h3><p>Torso height sweep recordings to follow.</p></div><span>Pending</span></div><div><Film size={21}/><div><h3>Teacher demonstrations</h3><p>Selected reference clips to follow.</p></div><span>Pending</span></div></div>
    </div>
  </section>
}
