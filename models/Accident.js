// ─── Accident Model (MySQL) ─────────────────────────────────────────────────────
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Accident = sequelize.define('Accident', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    lat: {
      type: DataTypes.DOUBLE,
      allowNull: false
    },
    lng: {
      type: DataTypes.DOUBLE,
      allowNull: false
    },
    severity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1, max: 5 }
    },
    description: {
      type: DataTypes.TEXT
    },
    roadType: {
      type: DataTypes.ENUM('highway', 'urban', 'rural', 'expressway'),
      defaultValue: 'urban'
    },
    weather: {
      type: DataTypes.ENUM('clear', 'rain', 'fog', 'storm'),
      defaultValue: 'clear'
    },
    timeOfDay: {
      type: DataTypes.ENUM('morning_rush', 'afternoon', 'evening_rush', 'night'),
      allowNull: false
    },
    roadSpeedLimit: {
      type: DataTypes.DOUBLE,
      defaultValue: 40
    },
    vehicleSpeed: {
      type: DataTypes.DOUBLE,
      defaultValue: null
    },
    fatalities: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    injuries: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    occurredAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'accidents',
    timestamps: true
  });

  return Accident;
};
