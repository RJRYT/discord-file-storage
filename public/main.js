// public/main.js
document.addEventListener("DOMContentLoaded", () => {
  const fileInput = document.getElementById("fileInput");
  const chooseBtn = document.getElementById("chooseBtn");
  const uploadBtn = document.getElementById("uploadBtn");
  const progressBar = document.querySelector(".progress-bar");
  const progressWrap = document.querySelector(".progress-wrap");
  const progressText = document.getElementById("progressText");
  const dropArea = document.querySelector(".upload-drop");

  let currentFile = null;

  function setProgress(p) {
    progressBar.style.width = `${p}%`;
    progressText.textContent = `${p.toFixed(0)}%`;
  }

  chooseBtn?.addEventListener("click", () => fileInput.click());
  fileInput?.addEventListener("change", (e) => {
    currentFile = e.target.files[0];
    renderFileName(currentFile);
  });

  // drag & drop
  if (dropArea) {
    ["dragenter", "dragover"].forEach((ev) => {
      dropArea.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropArea.classList.add("dragover");
      });
    });
    ["dragleave", "drop"].forEach((ev) => {
      dropArea.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropArea.classList.remove("dragover");
      });
    });
    dropArea.addEventListener("drop", (e) => {
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) {
        currentFile = f;
        fileInput.files = e.dataTransfer.files; // keep input in sync
        renderFileName(currentFile);
      }
    });
  }

  function renderFileName(file) {
    const el = document.getElementById("fileName");
    if (!file) {
      el.textContent = "No file chosen";
    } else {
      el.textContent = `${file.name} • ${(file.size / (1024 * 1024)).toFixed(
        2
      )} MB`;
    }
  }

  uploadBtn?.addEventListener("click", () => {
    if (!currentFile) return alert("Choose a file first");
    startUpload(currentFile);
  });

  function startUpload(file) {
    const xhr = new XMLHttpRequest();
    const url = "/upload";
    const fd = new FormData();
    fd.append("file", file);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const percent = (e.loaded / e.total) * 100;
        setProgress(percent);
      }
    });

    xhr.onreadystatechange = () => {
      if (xhr.readyState === 4) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data && data.ok && data.fileId) {
              // succesful upload - redirect to file page
              window.location.href = `/files/${data.fileId}`;
            } else {
              console.warn("Unexpected response", data);
              window.location.href = "/";
            }
          } catch (err) {
            // fallback: if server returned redirect HTML, just go home
            window.location.href = "/";
          }
        } else {
          alert("Upload failed: " + (xhr.responseText || xhr.statusText));
        }
      }
    };

    // show progress UI
    progressWrap.style.display = "block";
    setProgress(2);

    xhr.open("POST", url, true);
    xhr.setRequestHeader("Accept", "application/json"); // help server respond with JSON
    xhr.send(fd);
  }
});
