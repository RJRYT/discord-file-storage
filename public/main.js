// public/main.js
document.addEventListener('DOMContentLoaded', () => {
  // Mobile nav toggle
  const navToggle = document.querySelector('.nav-toggle');
  const mainNav = document.querySelector('.main-nav');
  const navLinks = document.querySelectorAll('.main-nav a, .main-nav button');

  if (navToggle && mainNav) {
    navToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      mainNav.classList.toggle('open');
    });

    // Close nav when clicking a link
    navLinks.forEach((link) => {
      link.addEventListener('click', () => {
        mainNav.classList.remove('open');
      });
    });

    // Close nav when clicking outside
    document.addEventListener('click', (e) => {
      if (!navToggle.contains(e.target) && !mainNav.contains(e.target)) {
        mainNav.classList.remove('open');
      }
    });
  }

  const fileInput = document.getElementById('fileInput');
  const chooseBtn = document.getElementById('chooseBtn');
  const uploadBtn = document.getElementById('uploadBtn');
  const progressBar = document.querySelector('.progress-bar');
  const progressWrap = document.querySelector('.progress-wrap');
  const progressText = document.getElementById('progressText');
  const statusText = document.getElementById('statusText');
  const chunkStatus = document.getElementById('chunkStatus');
  const chunkList = document.getElementById('chunkList');
  const dropArea = document.querySelector('.upload-drop');

  let currentFile = null;
  let fileId = null;
  let pollTimer = null;

  function setProgress(p) {
    if (!progressBar) return;
    progressBar.style.width = p + '%';
    if (progressText) progressText.textContent = p.toFixed(0) + '%';
  }

  function renderFileName(file) {
    const el = document.getElementById('fileName');
    if (!file) {
      el.textContent = 'No file chosen';
    } else {
      el.textContent = file.name + ' • ' + (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    }
  }

  chooseBtn?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', (e) => {
    currentFile = e.target.files[0];
    renderFileName(currentFile);
  });

  // drag & drop
  if (dropArea) {
    ['dragenter', 'dragover'].forEach((ev) => {
      dropArea.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropArea.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      dropArea.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropArea.classList.remove('dragover');
      });
    });
    dropArea.addEventListener('drop', (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        currentFile = f;
        renderFileName(currentFile);
      }
    });
  }

  const form = document.getElementById('uploadForm');
  if (form) {
    form.addEventListener('submit', (e) => {
      if (!currentFile) {
        e.preventDefault();
        alert('Choose a file first');
        return;
      }
      if (uploadBtn) {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Uploading...';
      }
      progressWrap.style.display = 'block';
      setProgress(2);
      if (statusText) statusText.textContent = 'Uploading file to server...';
      // Let the form submit normally (server returns JSON for XHR or redirect)
    });
  }

  // Upload status polling (for file detail page)
  const statusPollEl = document.getElementById('uploadStatusPoll');
  if (statusPollEl && fileId) {
    startStatusPolling(fileId);
  }

  function startStatusPolling(id) {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const resp = await fetch('/files/' + id + '/status', {
          headers: { Accept: 'application/json' },
        });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.ok) return;

        const pct = data.progressPercent || 0;
        setProgress(pct);
        if (statusText)
          statusText.textContent =
            'Uploaded ' + data.uploadedChunks + '/' + data.totalChunks + ' chunks';

        if (chunkList && data.chunks) {
          chunkList.innerHTML = data.chunks
            .map(
              (c) =>
                "<div style='font-size:12px;color:var(--muted);margin:4px 0;'><span style='color:var(--accent)'>Chunk " +
                c.index +
                '</span>: ' +
                c.status +
                '</div>'
            )
            .join('');
          chunkStatus.style.display = 'block';
        }

        if (data.uploadStatus === 'completed' || data.uploadStatus === 'failed') {
          clearInterval(pollTimer);
          if (statusText)
            statusText.textContent =
              data.uploadStatus === 'completed' ? 'Upload completed!' : 'Upload failed.';
        }
      } catch (err) {
        // ignore poll errors
      }
    }, 2000);
  }
});
