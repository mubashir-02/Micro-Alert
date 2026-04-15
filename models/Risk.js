const mongoose = require('mongoose');

const riskSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['sudden_brake', 'blind_turn', 'habitual_violation'],
    required: true
  },
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point',
      required: true
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  severity: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  timeOfDay: {
    type: String,
    enum: ['morning_rush', 'afternoon', 'evening_rush', 'night'],
    required: true
  },
  weather: {
    type: String,
    enum: ['clear', 'rain', 'fog'],
    default: 'clear'
  },
  roadName: {
    type: String,
    required: true
  },
  landmark: {
    type: String,
    default: ''
  },
  verified: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Create 2dsphere index for geospatial queries
riskSchema.index({ location: '2dsphere' });

// Index for common queries
riskSchema.index({ severity: -1 });
riskSchema.index({ type: 1 });
riskSchema.index({ timeOfDay: 1 });

module.exports = mongoose.model('Risk', riskSchema);
