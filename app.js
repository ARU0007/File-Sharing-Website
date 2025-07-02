const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // Allow inline styles and scripts for this demo
  })
);
app.use(cors());

// Rate limiting
const uploadLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 uploads per windowMs
  message: "Too many uploads, please try again later.",
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// File storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const uniqueId = crypto.randomBytes(16).toString("hex");
    const extension = path.extname(file.originalname);
    cb(null, uniqueId + extension);
  },
});

// File filter for security
const fileFilter = (req, file, cb) => {
  // Block potentially dangerous file types
  const dangerousTypes = [
    ".exe",
    ".scr",
    ".bat",
    ".cmd",
    ".com",
    ".pif",
    ".vbs",
    ".js",
  ];
  const extension = path.extname(file.originalname).toLowerCase();

  if (dangerousTypes.includes(extension)) {
    return cb(new Error("File type not allowed for security reasons"), false);
  }

  cb(null, true);
};

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
    files: 5, // Max 5 files at once
  },
  fileFilter: fileFilter,
});

// In-memory storage for file metadata (use database in production)
const fileMetadata = new Map();

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "index.html"));
});

// Upload files
app.post("/upload", uploadLimit, upload.array("files", 5), (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const uploadedFiles = req.files.map((file) => {
      const shareId = crypto.randomBytes(16).toString("hex");
      const fileInfo = {
        id: shareId,
        originalName: file.originalname,
        filename: file.filename,
        size: file.size,
        mimetype: file.mimetype,
        uploadDate: new Date(),
        downloadCount: 0,
        maxDownloads: parseInt(req.body.maxDownloads) || null,
        expiryDate: req.body.expiryHours
          ? new Date(
              Date.now() + parseInt(req.body.expiryHours) * 60 * 60 * 1000
            )
          : null,
      };

      fileMetadata.set(shareId, fileInfo);

      return {
        shareId: shareId,
        originalName: file.originalname,
        size: file.size,
        shareUrl: `${req.protocol}://${req.get("host")}/share/${shareId}`,
      };
    });

    res.json({
      success: true,
      files: uploadedFiles,
    });
  } catch (error) {
    res.status(500).json({ error: "Upload failed: " + error.message });
  }
});

// Get file info for sharing page
app.get("/api/file/:shareId", (req, res) => {
  const { shareId } = req.params;
  const fileInfo = fileMetadata.get(shareId);

  if (!fileInfo) {
    return res.status(404).json({ error: "File not found" });
  }

  // Check if file has expired
  if (fileInfo.expiryDate && new Date() > fileInfo.expiryDate) {
    fileMetadata.delete(shareId);
    // Delete physical file
    const filePath = path.join(uploadsDir, fileInfo.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return res.status(410).json({ error: "File has expired" });
  }

  // Check download limit
  if (
    fileInfo.maxDownloads &&
    fileInfo.downloadCount >= fileInfo.maxDownloads
  ) {
    return res.status(410).json({ error: "Download limit exceeded" });
  }

  res.json({
    originalName: fileInfo.originalName,
    size: fileInfo.size,
    uploadDate: fileInfo.uploadDate,
    downloadCount: fileInfo.downloadCount,
    maxDownloads: fileInfo.maxDownloads,
    expiryDate: fileInfo.expiryDate,
  });
});

// Download file
app.get("/download/:shareId", (req, res) => {
  const { shareId } = req.params;
  const fileInfo = fileMetadata.get(shareId);

  if (!fileInfo) {
    return res.status(404).send("File not found");
  }

  // Check if file has expired
  if (fileInfo.expiryDate && new Date() > fileInfo.expiryDate) {
    fileMetadata.delete(shareId);
    const filePath = path.join(uploadsDir, fileInfo.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return res.status(410).send("File has expired");
  }

  // Check download limit
  if (
    fileInfo.maxDownloads &&
    fileInfo.downloadCount >= fileInfo.maxDownloads
  ) {
    return res.status(410).send("Download limit exceeded");
  }

  const filePath = path.join(uploadsDir, fileInfo.filename);

  if (!fs.existsSync(filePath)) {
    fileMetadata.delete(shareId);
    return res.status(404).send("File not found on server");
  }

  // Increment download count
  fileInfo.downloadCount++;

  // Set headers for download
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileInfo.originalName}"`
  );
  res.setHeader("Content-Type", fileInfo.mimetype);

  // Stream the file
  const fileStream = fs.createReadStream(filePath);
  fileStream.pipe(res);

  fileStream.on("error", (err) => {
    console.error("Error streaming file:", err);
    res.status(500).send("Error downloading file");
  });
});

// File sharing page
app.get("/share/:shareId", (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "share.html"));
});

// Get all files (admin endpoint - should be protected in production)
app.get("/api/files", (req, res) => {
  const files = Array.from(fileMetadata.entries()).map(([id, info]) => ({
    id,
    ...info,
  }));
  res.json(files);
});

// Cleanup expired files (run periodically)
const cleanupExpiredFiles = () => {
  const now = new Date();
  for (const [shareId, fileInfo] of fileMetadata.entries()) {
    if (fileInfo.expiryDate && now > fileInfo.expiryDate) {
      const filePath = path.join(uploadsDir, fileInfo.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      fileMetadata.delete(shareId);
      console.log(`Cleaned up expired file: ${fileInfo.originalName}`);
    }
  }
};

// Run cleanup every hour
setInterval(cleanupExpiredFiles, 60 * 60 * 1000);

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large (max 100MB)" });
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res.status(400).json({ error: "Too many files (max 5)" });
    }
  }
  res.status(500).json({ error: error.message });
});

// 404 handler
app.use((req, res) => {
  res.status(404).send("Page not found");
});

app.listen(PORT, () => {
  console.log(`File sharing server running on port ${PORT}`);
  console.log(`Access the application at http://localhost:${PORT}`);
});
