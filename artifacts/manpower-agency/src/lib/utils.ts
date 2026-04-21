import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateVideoThumbnail(src: string): Promise<{ thumbnail: string; duration: string }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    // Must be in DOM for some browsers to decode frames
    video.style.position = "fixed";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";
    video.style.width = "1px";
    video.style.height = "1px";
    document.body.appendChild(video);

    const cleanup = () => {
      try { if (document.body.contains(video)) document.body.removeChild(video); } catch {}
    };

    let done = false;

    const capture = () => {
      if (done) return;
      done = true;
      // Small delay to let browser decode the frame fully
      setTimeout(() => {
        try {
          const w = video.videoWidth  || 160;
          const h = video.videoHeight || 160;
          const canvas = document.createElement("canvas");
          canvas.width  = 160;
          canvas.height = 160;
          const ctx = canvas.getContext("2d");
          if (!ctx) { cleanup(); reject(new Error("No canvas")); return; }
          // Draw with aspect-fill into the square
          const scale = Math.max(160 / w, 160 / h);
          const dw = w * scale, dh = h * scale;
          const dx = (160 - dw) / 2, dy = (160 - dh) / 2;
          ctx.drawImage(video, dx, dy, dw, dh);
          const dur = isFinite(video.duration)
            ? `${Math.floor(video.duration / 60)}:${String(Math.floor(video.duration % 60)).padStart(2, "0")}`
            : "";
          const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
          cleanup();
          resolve({ thumbnail: dataUrl, duration: dur });
        } catch (e) { cleanup(); reject(e); }
      }, 100);
    };

    video.addEventListener("seeked", capture);
    video.addEventListener("loadeddata", () => {
      if (done) return;
      const t = isFinite(video.duration) ? Math.min(1.5, video.duration * 0.1) : 0;
      video.currentTime = t;
    });
    video.addEventListener("error", () => { cleanup(); reject(new Error("Video load error")); });

    setTimeout(() => {
      if (!done) { cleanup(); reject(new Error("Timeout")); }
    }, 10000);

    video.src = src;
    video.load();
  });
}
