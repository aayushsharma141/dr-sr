const out = { proto: location.protocol, host: location.host, isSecureContext: window.isSecureContext, hasMediaDevices: !!navigator.mediaDevices }
if (navigator.mediaDevices) {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ video: true })
    out.getUserMedia = 'ok, video tracks=' + s.getVideoTracks().length
    s.getTracks().forEach((t) => t.stop())
  } catch (e) { out.getUserMedia = 'FAILED ' + e.name }
} else { out.getUserMedia = 'navigator.mediaDevices is undefined' }
document.getElementById('out').textContent = JSON.stringify(out, null, 1)