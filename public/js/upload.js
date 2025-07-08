// Get DOM elements
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("uploadBtn");
const fileList = document.getElementById("fileList");
const progressContainer = document.getElementById("progressContainer");
const progressFill = document.getElementById("progressFill");
const errorDiv = document.getElementById("errorDiv");
const results = document.getElementById("results");
const expiryHours = document.getElementById("expiryHours");
const maxDownloads = document.getElementById("maxDownloads");

let selectedFiles = [];

// Handle upload area click
uploadArea.addEventListener("click", () => {
  fileInput.click();
});

// Handle file input change
fileInput.addEventListener("change", (e) => {
  handleFiles(Array.from(e.target.files));
});

// Handle drag and drop
uploadArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  uploadArea.classList.add("dragover");
});

uploadArea.addEventListener("dragleave", () => {
  uploadArea.classList.remove("dragover");
});

uploadArea.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
  handleFiles(Array.from(e.dataTransfer.files));
});

// Function to handle selected files
function handleFiles(files) {
  // Validate file count
  if (files.length > 5) {
    showError("Maximum 5 files allowed");
    return;
  }

  // Validate file sizes
  const maxSize = 100 * 1024 * 1024; // 100MB
  for (let file of files) {
    if (file.size > maxSize) {
      showError(`File "${file.name}" is too large. Maximum size is 100MB.`);
      return;
    }
  }

  selectedFiles = files;
  displayFiles(files);
  uploadBtn.disabled = false;
  hideError();
}

// Function to display selected files
function displayFiles(files) {
  fileList.innerHTML = "";
  files.forEach((file, index) => {
    const fileItem = document.createElement("div");
    fileItem.className = "file-item";
    fileItem.innerHTML = `
      <div class="file-info">
        <div class="file-name">${file.name}</div>
        <div class="file-size">${formatFileSize(file.size)}</div>
      </div>
      <button class="remove-file" onclick="removeFile(${index})">Remove</button>
    `;
    fileList.appendChild(fileItem);
  });
}

// Function to remove a file
function removeFile(index) {
  selectedFiles.splice(index, 1);
  if (selectedFiles.length === 0) {
    fileList.innerHTML = "";
    uploadBtn.disabled = true;
  } else {
    displayFiles(selectedFiles);
  }
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Handle upload button click
uploadBtn.addEventListener("click", uploadFiles);

// Function to upload files
async function uploadFiles() {
  if (selectedFiles.length === 0) {
    showError("Please select files to upload");
    return;
  }

  const formData = new FormData();

  // Add files to form data
  selectedFiles.forEach((file) => {
    formData.append("files", file);
  });

  // Add options
  if (expiryHours.value) {
    formData.append("expiryHours", expiryHours.value);
  }
  if (maxDownloads.value) {
    formData.append("maxDownloads", maxDownloads.value);
  }

  // Show progress
  progressContainer.style.display = "block";
  progressFill.style.width = "0%";
  uploadBtn.disabled = true;
  hideError();

  try {
    const xhr = new XMLHttpRequest();

    // Handle progress
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        progressFill.style.width = percentComplete + "%";
      }
    });

    // Handle response
    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        const response = JSON.parse(xhr.responseText);
        displayResults(response.files);
        resetForm();
      } else {
        const error = JSON.parse(xhr.responseText);
        showError(error.error || "Upload failed");
      }
      progressContainer.style.display = "none";
      uploadBtn.disabled = false;
    });

    // Handle errors
    xhr.addEventListener("error", () => {
      showError("Upload failed. Please try again.");
      progressContainer.style.display = "none";
      uploadBtn.disabled = false;
    });

    // Send request
    xhr.open("POST", "/upload");
    xhr.send(formData);
  } catch (error) {
    showError("Upload failed: " + error.message);
    progressContainer.style.display = "none";
    uploadBtn.disabled = false;
  }
}

// Function to display upload results
function displayResults(files) {
  results.innerHTML = "";
  results.style.display = "block";

  files.forEach((file) => {
    const resultItem = document.createElement("div");
    resultItem.className = "result-item";
    resultItem.innerHTML = `
      <h3>${file.originalName}</h3>
      <p>Size: ${formatFileSize(file.size)}</p>
      <div class="share-link" id="link-${file.shareId}">${file.shareUrl}</div>
      <button class="copy-btn" onclick="copyToClipboard('${file.shareUrl}', '${
      file.shareId
    }')">Copy Link</button>
    `;
    results.appendChild(resultItem);
  });
}

// Function to copy link to clipboard
async function copyToClipboard(url, shareId) {
  try {
    await navigator.clipboard.writeText(url);
    const button = document.querySelector(
      `#link-${shareId}`
    ).nextElementSibling;
    const originalText = button.textContent;
    button.textContent = "Copied!";
    button.style.background = "#4caf50";

    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = "#667eea";
    }, 2000);
  } catch (err) {
    // Fallback for older browsers
    const textArea = document.createElement("textarea");
    textArea.value = url;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand("copy");
    document.body.removeChild(textArea);

    const button = document.querySelector(
      `#link-${shareId}`
    ).nextElementSibling;
    const originalText = button.textContent;
    button.textContent = "Copied!";
    button.style.background = "#4caf50";

    setTimeout(() => {
      button.textContent = originalText;
      button.style.background = "#667eea";
    }, 2000);
  }
}

// Function to show error
function showError(message) {
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
}

// Function to hide error
function hideError() {
  errorDiv.style.display = "none";
}

// Function to reset form
function resetForm() {
  selectedFiles = [];
  fileList.innerHTML = "";
  fileInput.value = "";
  uploadBtn.disabled = true;
  progressFill.style.width = "0%";
}
