"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function VideoPreview({
  src,
  title,
  className
}: {
  src: string;
  title: string;
  className: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [frameReady, setFrameReady] = useState(false);

  const revealFirstFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;

    const targetTime = Number.isFinite(video.duration) && video.duration > 0.12 ? 0.08 : 0;
    if (Math.abs(video.currentTime - targetTime) < 0.01) {
      setFrameReady(true);
      return;
    }

    try {
      video.currentTime = targetTime;
    } catch {
      setFrameReady(true);
    }
  }, []);

  useEffect(() => {
    setFrameReady(false);
  }, [src]);

  return (
    <video
      ref={videoRef}
      className={`${className} ${frameReady ? "is-frame-ready" : ""}`}
      src={src}
      title={title}
      controls
      controlsList="nofullscreen"
      preload="metadata"
      playsInline
      disablePictureInPicture
      onDoubleClickCapture={(event) => {
        event.preventDefault();
      }}
      onLoadedMetadata={revealFirstFrame}
      onLoadedData={revealFirstFrame}
      onSeeked={() => setFrameReady(true)}
    />
  );
}
