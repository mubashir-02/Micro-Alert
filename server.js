require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { sequelize } = require('./models');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const SHOULD_ALTER_SCHEMA = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.DB_SYNC_ALTER || '').toLowerCase()
);

// ─── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Make io accessible to routes
app.set('io', io);

// ─── View Engine ────────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── Routes ─────────────────────────────────────────────────────────────────────
const apiRoutes = require('./routes/api');
app.use('/api', apiRoutes);

const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

const emergencyRoutes = require('./routes/emergency');
app.use('/api/emergency', emergencyRoutes);

const speedRoutes = require('./routes/speed');
app.use('/api/speed', speedRoutes);

const predictionRoutes = require('./routes/prediction');
app.use('/api/prediction', predictionRoutes);

const routingRoutes = require('./routes/routing');
app.use('/api/routing', routingRoutes);

const uploadRoutes = require('./routes/upload');
app.use('/api/upload', uploadRoutes);

// ─── Feature D: Predictive Congestion Engine (new, additive) ────────────────────
const predictionEngineRoutes = require('./predictionEngine');
app.use('/api/prediction-engine', predictionEngineRoutes);

// ─── Feature E: Gamification System (new, additive) ─────────────────────────────
const gamificationRoutes = require('./gamification');
app.use('/api/game', gamificationRoutes);

// ─── Feature F: Offline Risk Map API (new, additive) ────────────────────────────
const offlineRoutes = require('./routes/offline');
app.use('/api/offline', offlineRoutes);

// Main page
app.get('/', (req, res) => {
  res.render('index', {
    title: 'MicroAlert · Smart Road Safety & Navigation'
  });
});

// ─── Socket.io ──────────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await sequelize.authenticate();
    res.json({
      ok: true,
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

io.on('connection', (socket) => {
  console.log('🔌 User connected:', socket.id);

  // User location update
  socket.on('location-update', (data) => {
    socket.broadcast.emit('user-location', {
      socketId: socket.id,
      ...data
    });
  });

  // Emergency dispatch broadcast
  socket.on('emergency-dispatch', (data) => {
    io.emit('new-dispatch', data);
  });

  // Hazard update broadcast
  socket.on('hazard-update', (data) => {
    io.emit('hazard-changed', data);
  });

  socket.on('disconnect', () => {
    io.emit('user-disconnected', { socketId: socket.id });
  });
});

// ─── MySQL Connection ───────────────────────────────────────────────────────────
sequelize.authenticate()
  .then(() => {
    console.log('✅ MySQL connected to microalert');
    return sequelize.sync({ alter: SHOULD_ALTER_SCHEMA });
  })
  .then(() => {
    console.log('✅ Database tables synced');
    server.listen(PORT, () => {
      console.log(`🚀 MicroAlert running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MySQL connection error:', err.message);
    console.log('Starting server without database...');
    server.listen(PORT, () => {
      console.log(`🚀 MicroAlert running at http://localhost:${PORT} (no database)`);
    });
  });

module.exports = { app, server, io };
