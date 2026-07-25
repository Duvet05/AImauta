"use client";

import { useEffect, useRef, useState } from "react";

type TavusAvatarVideoProps = {
  track: MediaStreamTrack | null;
  onReadyChange: (ready: boolean) => void;
};

export function TavusAvatarVideo({
  track,
  onReadyChange,
}: TavusAvatarVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [readyTrack, setReadyTrack] = useState<MediaStreamTrack | null>(null);
  const ready = track !== null && readyTrack === track;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !track || track.kind !== "video") {
      if (video) video.srcObject = null;
      return;
    }

    const markReady = () => {
      setReadyTrack(track);
      onReadyChange(true);
    };
    const markUnavailable = () => {
      setReadyTrack((current) => (current === track ? null : current));
      onReadyChange(false);
    };
    video.srcObject = new MediaStream([track]);
    video.addEventListener("playing", markReady);
    video.addEventListener("loadeddata", markReady);
    video.addEventListener("error", markUnavailable);
    void video.play().catch(markUnavailable);

    return () => {
      video.removeEventListener("playing", markReady);
      video.removeEventListener("loadeddata", markReady);
      video.removeEventListener("error", markUnavailable);
      video.pause();
      video.srcObject = null;
      onReadyChange(false);
    };
  }, [onReadyChange, track]);

  return (
    <video
      ref={videoRef}
      className={`tutor-avatar-video${
        ready ? " tutor-avatar-video-ready" : ""
      }`}
      autoPlay
      muted
      playsInline
      aria-hidden="true"
    />
  );
}
