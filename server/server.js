const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const path = require('path');
const cloudinary = require('cloudinary').v2;
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// MySQL configuration
const dbConfig = {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: {
        rejectUnauthorized: false, // Only for development; tighten in production
    },
};

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Serve static files for the chat application
app.use(express.static('public'));

// Socket.IO handling
io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('join', async ({ username, chatRoomId }) => {
    socket.join(chatRoomId);
    console.log(`${username} joined room: ${chatRoomId}`);

    try {
      // Fetch previous messages from the database for the chat room
      const connection = await mysql.createConnection(dbConfig);
      const [rows] = await connection.execute(
        'SELECT sender, message FROM messages WHERE chatRoomId = ? ORDER BY id ASC',
        [chatRoomId]
      );
      connection.end();

      // Send previous messages to the client
      socket.emit('previousMessages', rows);
    } catch (err) {
      console.error('Database error:', err);
    }
  });

  // Handle text messages
  socket.on('message', async ({ sender, receiver, message, chatRoomId }) => {
    if (message && message !== "") {
      try {
        const connection = await mysql.createConnection(dbConfig);
        await connection.execute(
          'INSERT INTO messages (sender, receiver, message, chatRoomId, type) VALUES (?, ?, ?, ?, ?)',
          [sender, receiver, message, chatRoomId, 'text']
        );
        connection.end();
      } catch (err) {
        console.error('Database error:', err);
      }

      // Broadcast the text message
      io.to(chatRoomId).emit('message', { sender, message });
    }
  });

  // Handle file uploads
  socket.on('uploadFile', async ({ sender, receiver, fileName, fileData, chatRoomId }) => {
    try {
      // Upload file to Cloudinary
      const result = await cloudinary.uploader.upload(`data:;base64,${fileData}`, {
        resource_type: 'auto', // Auto-detect file type
        folder: 'chat_uploads', // Optional folder for organization
        public_id: `${Date.now()}_${fileName}`,
      });

      const fileUrl = result.secure_url;

      // Save the file URL into the database
      const connection = await mysql.createConnection(dbConfig);
      await connection.execute(
        'INSERT INTO messages (sender, receiver, message, chatRoomId, type) VALUES (?, ?, ?, ?, ?)',
        [sender, receiver, `<a href="${fileUrl}" target="_blank">${fileName}</a>`, chatRoomId, 'file']
      );
      connection.end();

      // Broadcast the file upload message
      io.to(chatRoomId).emit('message', {
        sender,
        message: `<a href="${fileUrl}" target="_blank">${fileName}</a>`, // Send file URL as clickable link
        type: 'file',
      });

      console.log('File uploaded successfully:', fileUrl);
    } catch (err) {
      console.error('Error uploading file to Cloudinary:', err);

      // Optionally, notify the sender about the failure
      socket.emit('uploadError', { error: 'Failed to transmit file.' });
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
