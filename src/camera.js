// Start camera and attach stream to a video element
export async function startCamera(videoEl) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Camera access denied. Please allow camera access in your browser settings.');
    }
    if (err.name === 'NotFoundError') {
      throw new Error('No camera found on this device.');
    }
    throw new Error(`Camera error: ${err.message}`);
  }

  videoEl.srcObject = stream;
  await videoEl.play();
  return stream;
}

// Stop camera and detach stream
export function stopCamera(stream, videoEl) {
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
  }
  if (videoEl) {
    videoEl.srcObject = null;
  }
}
