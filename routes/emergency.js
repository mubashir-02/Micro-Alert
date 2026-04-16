// ─── Emergency Dispatch Routes ──────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { EmergencyDispatch } = require('../models');

// ─── GET /api/emergency ─ Emergency services data ──────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { lat, lng } = req.query;
    const emergencyServices = [
      { type: 'hospital', name: 'Apollo Hospital, Greams Road', address: '21, Greams Lane, Off Greams Road, Chennai', phone: '044-2829-3333', lat: 13.0604, lng: 80.2522, icon: '🏥' },
      { type: 'hospital', name: 'MIOT International Hospital', address: '4/112, Mount Poonamallee Road, Manapakkam', phone: '044-4200-0000', lat: 13.0285, lng: 80.1694, icon: '🏥' },
      { type: 'hospital', name: 'Government General Hospital', address: 'Park Town, Chennai', phone: '044-2530-5000', lat: 13.0878, lng: 80.2785, icon: '🏥' },
      { type: 'hospital', name: 'Fortis Malar Hospital', address: '52, 1st Main Road, Adyar, Chennai', phone: '044-4289-2222', lat: 13.0067, lng: 80.2565, icon: '🏥' },
      { type: 'police', name: 'T. Nagar Police Station', address: 'South Usman Road, T. Nagar', phone: '044-2434-1212', lat: 13.0418, lng: 80.2341, icon: '🚔' },
      { type: 'police', name: 'Adyar Traffic Police', address: 'Adyar, Chennai', phone: '044-2440-1818', lat: 13.0063, lng: 80.2574, icon: '🚔' },
      { type: 'police', name: 'Anna Nagar Police Station', address: '2nd Avenue, Anna Nagar', phone: '044-2628-5555', lat: 13.0850, lng: 80.2101, icon: '🚔' },
      { type: 'police', name: 'Guindy Traffic Police', address: 'Guindy, Chennai', phone: '044-2234-0000', lat: 13.0067, lng: 80.2206, icon: '🚔' },
      { type: 'fire', name: 'Teynampet Fire Station', address: 'Anna Salai, Teynampet', phone: '044-2435-1010', lat: 13.0450, lng: 80.2480, icon: '🚒' },
      { type: 'fire', name: 'Anna Nagar Fire Station', address: '2nd Avenue, Anna Nagar', phone: '044-2626-1234', lat: 13.0870, lng: 80.2130, icon: '🚒' },
      { type: 'roadside', name: 'RSA Chennai - 24/7', address: 'Pan-Chennai Coverage', phone: '1800-123-5555', lat: 13.0500, lng: 80.2500, icon: '🆘' },
      { type: 'roadside', name: 'TVS Roadside Assist', address: 'Pan-Chennai Coverage', phone: '1800-102-8877', lat: 13.0300, lng: 80.2300, icon: '🆘' }
    ];

    if (lat && lng) {
      const userLat = parseFloat(lat);
      const userLng = parseFloat(lng);
      emergencyServices.forEach(s => {
        const dLat = s.lat - userLat;
        const dLng = s.lng - userLng;
        s.distance = Math.sqrt(dLat * dLat + dLng * dLng) * 111;
      });
      emergencyServices.sort((a, b) => a.distance - b.distance);
    }

    res.json({ success: true, data: emergencyServices });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /api/emergency/dispatch ─ Create emergency dispatch ──────────────────
router.post('/dispatch', async (req, res) => {
  try {
    const { type, lat, lng, incidentType, routeSnapshot, userId } = req.body;

    if (!type || !lat || !lng) {
      return res.status(400).json({ success: false, error: 'type, lat, lng are required' });
    }

    const dispatch = await EmergencyDispatch.create({
      type,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      incidentType: incidentType || 'general',
      routeSnapshot: routeSnapshot ? JSON.stringify(routeSnapshot) : null,
      userId: userId || null,
      status: 'pending',
      dispatchedAt: new Date()
    });

    // Broadcast to all connected clients
    const io = req.app.get('io');
    if (io) {
      io.emit('new-dispatch', {
        ...dispatch.toJSON(),
        _id: dispatch.id
      });
    }

    res.json({ success: true, data: { ...dispatch.toJSON(), _id: dispatch.id } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /api/emergency/dispatches ─ Recent dispatches ─────────────────────────
router.get('/dispatches', async (req, res) => {
  try {
    const dispatches = await EmergencyDispatch.findAll({
      order: [['createdAt', 'DESC']],
      limit: 50,
      raw: true
    });
    res.json({ success: true, data: dispatches.map(d => ({ ...d, _id: d.id })) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
