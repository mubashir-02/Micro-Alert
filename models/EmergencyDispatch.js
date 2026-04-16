// ─── Emergency Dispatch Model (MySQL) ───────────────────────────────────────────
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const EmergencyDispatch = sequelize.define('EmergencyDispatch', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    type: {
      type: DataTypes.ENUM('ambulance', 'police', 'fire', 'roadside'),
      allowNull: false
    },
    lat: {
      type: DataTypes.DOUBLE,
      allowNull: false
    },
    lng: {
      type: DataTypes.DOUBLE,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM('pending', 'dispatched', 'en_route', 'arrived', 'resolved', 'cancelled'),
      defaultValue: 'pending'
    },
    incidentType: {
      type: DataTypes.STRING(255),
      defaultValue: 'general'
    },
    routeSnapshot: {
      type: DataTypes.TEXT
    },
    dispatchedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    resolvedAt: {
      type: DataTypes.DATE,
      defaultValue: null
    }
  }, {
    tableName: 'emergency_dispatches',
    timestamps: true
  });

  return EmergencyDispatch;
};
