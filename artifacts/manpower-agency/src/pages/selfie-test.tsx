import { useRef, useState } from "react";
import { FaceDetection } from "@mediapipe/face_detection";
import { Camera } from "@mediapipe/camera_utils";

export default function SelfieTest() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const detectorRef = useRef<FaceDetection | null>(null);
  const cameraRef = useRef<Camera | null>(null);

  const [status, setStatus] = useState<string>("Idle — click Start");
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);

  const pushLog = (msg: string) => {
    console.log(msg);
    setLog(prev => [msg, ...prev].slice(0, 30));
  };

  const start = async () => {
    const video = videoRef.current;
    if (!video) return;

    setRunning(true);
    setStatus("Initializing MediaPipe Face Detection...");
    pushLog("Creating FaceDetection instance...");

    // 1. Create the FaceDetection instance.
    //    locateFile points to locally-served model files so no external CDN is needed.
    const fd = new FaceDetection({
      locateFile: (file: string) =>
        `${import.meta.env.BASE_URL}mp-fd/${file}`,
    });

    // 2. Configure: model=short, confidence=0.5
    fd.setOptions({
      model: "short",
      minDetectionConfidence: 0.5,
    });

    // 3. Register the results callback.
    //    This fires once per frame after fd.send() completes.
    fd.onResults((results) => {
      if (results.detections && results.detections.length > 0) {
        const d = results.detections[0];
        const bb = d.boundingBox;
        const msg = `Face detected — x:${bb?.xCenter?.toFixed(3)} y:${bb?.yCenter?.toFixed(3)} w:${bb?.width?.toFixed(3)}`;
        console.log("Face detected");
        setStatus(msg);
      } else {
        console.log("No face");
        setStatus("No face");
      }
    });

    detectorRef.current = fd;
    pushLog("FaceDetection instance created. Loading model files from /mp-fd/...");

    // 4. Request camera access and start the Camera utility loop.
    //    Camera.onFrame calls fd.send({ image: video }) every frame.
    const camera = new Camera(video, {
      onFrame: async () => {
        try {
          await fd.send({ image: video });
        } catch (err) {
          console.error("send() error:", err);
        }
      },
      width: 640,
      height: 480,
    });

    cameraRef.current = camera;

    try {
      await camera.start();
      pushLog("Camera started. Model loading...");
      setStatus("Camera running — waiting for first detection...");
      pushLog("Detection loop active. Watch console for Face detected / No face");
    } catch (err) {
      pushLog(`ERROR starting camera: ${err}`);
      setStatus(`Camera error: ${err}`);
      setRunning(false);
    }
  };

  const stop = () => {
    cameraRef.current?.stop();
    cameraRef.current = null;
    detectorRef.current?.close();
    detectorRef.current = null;
    setRunning(false);
    setStatus("Stopped");
    pushLog("Stopped.");
  };

  return (
    <div style={{ fontFamily: "monospace", padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <h2 style={{ marginBottom: 4 }}>MediaPipe Face Detection — Diagnostic</h2>
      <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 16 }}>
        Open <strong>DevTools → Console</strong> to see per-frame <code>Face detected</code> / <code>No face</code> logs.
      </p>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <button
          onClick={start}
          disabled={running}
          style={{ padding: "8px 20px", background: running ? "#9ca3af" : "#4f46e5", color: "#fff", border: "none", borderRadius: 6, cursor: running ? "not-allowed" : "pointer" }}
        >
          Start
        </button>
        <button
          onClick={stop}
          disabled={!running}
          style={{ padding: "8px 20px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: !running ? "not-allowed" : "pointer" }}
        >
          Stop
        </button>
      </div>

      {/* Video element — Camera utility attaches srcObject here */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", maxWidth: 480, background: "#000", borderRadius: 8, display: "block", marginBottom: 12 }}
      />

      {/* Status box — green on detection, red on no face */}
      <div style={{
        padding: "10px 14px",
        background: status.startsWith("Face detected") ? "#dcfce7"
          : status === "No face" ? "#fee2e2"
          : "#f3f4f6",
        border: `2px solid ${status.startsWith("Face detected") ? "#16a34a" : status === "No face" ? "#dc2626" : "#d1d5db"}`,
        borderRadius: 6,
        marginBottom: 12,
        fontSize: 14,
        fontWeight: 600,
      }}>
        Status: {status}
      </div>

      {/* Log panel */}
      <div style={{
        background: "#1e1e1e",
        color: "#d4d4d4",
        borderRadius: 6,
        padding: 12,
        fontSize: 12,
        lineHeight: 1.7,
        maxHeight: 250,
        overflowY: "auto",
      }}>
        {log.length === 0
          ? <span style={{ color: "#6b7280" }}>Log will appear here after Start…</span>
          : log.map((l, i) => <div key={i}>{l}</div>)
        }
      </div>
    </div>
  );
}
