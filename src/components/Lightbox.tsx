import { useEffect, useRef, useState } from 'react'
import { useEscape } from './Dialogs'

export type MediaView =
  | { kind: 'images'; images: { fullsize: string; thumb: string; alt: string }[]; index: number }
  | { kind: 'video'; playlist: string; thumbnail?: string; alt?: string; gif?: boolean }

/** Full-window preview of a post's images or video, over the whole deck. */
export function Lightbox({ media, onClose }: { media: MediaView; onClose(): void }) {
  useEscape(onClose)
  return (
    <div className="lightbox" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <button type="button" className="lightbox-close" title="Close (Esc)" onClick={onClose}>
        ×
      </button>
      {media.kind === 'images' ? <Images media={media} /> : <Video media={media} />}
    </div>
  )
}

function Images({ media }: { media: Extract<MediaView, { kind: 'images' }> }) {
  const [index, setIndex] = useState(media.index)
  const count = media.images.length
  const image = media.images[index]
  const step = (d: number) => setIndex((i) => (i + d + count) % count)

  useEffect(() => {
    if (count < 2) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') step(-1)
      if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // `step` only uses the state setter and `count`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count])

  return (
    <>
      {count > 1 && (
        <button type="button" className="lightbox-nav prev" title="Previous (←)" onClick={() => step(-1)}>
          ‹
        </button>
      )}
      <figure>
        {/* The thumbnail shows at once while the full-size image loads over it. */}
        <img key={image.fullsize} src={image.fullsize} alt={image.alt} style={{ backgroundImage: `url("${image.thumb}")` }} />
        {(image.alt || count > 1) && (
          <figcaption>
            {count > 1 && <span className="muted">{`${index + 1} / ${count}`}</span>}
            {image.alt && <span>{image.alt}</span>}
          </figcaption>
        )}
      </figure>
      {count > 1 && (
        <button type="button" className="lightbox-nav next" title="Next (→)" onClick={() => step(1)}>
          ›
        </button>
      )}
    </>
  )
}

function Video({ media }: { media: Extract<MediaView, { kind: 'video' }> }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')

  // Bluesky serves video as HLS. hls.js (fetched only the first time a video
  // plays) handles it wherever MediaSource exists. Chrome claims native HLS
  // support but did not load these streams in testing, so the browser's own
  // player is only the fallback.
  useEffect(() => {
    const video = ref.current
    if (!video) return
    let stopped = false
    let destroy = () => {}
    import('hls.js')
      .then(({ default: Hls }) => {
        if (stopped) return
        if (!Hls.isSupported()) {
          if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = media.playlist
          else setError('This browser cannot play Bluesky videos.')
          return
        }
        const hls = new Hls({ enableWorker: false })
        hls.on(Hls.Events.ERROR, (_e, data) => data.fatal && setError('The video could not be loaded.'))
        hls.loadSource(media.playlist)
        hls.attachMedia(video)
        destroy = () => hls.destroy()
      })
      .catch(() => setError('The video player could not be loaded.'))
    return () => {
      stopped = true
      destroy()
    }
  }, [media.playlist])

  return (
    <figure className="video-figure">
      <video
        ref={ref}
        poster={media.thumbnail}
        aria-label={media.alt}
        controls={!media.gif}
        autoPlay
        loop={media.gif}
        muted={media.gif}
        playsInline
      />
      {(error || media.alt) && <figcaption>{error ? <span className="error">{error}</span> : media.alt}</figcaption>}
    </figure>
  )
}
