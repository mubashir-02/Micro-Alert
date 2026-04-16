// ─── Speed Log Model (MySQL) ────────────────────────────────────────────────────
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const SpeedLog = sequelize.define('SpeedLog', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    speed: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      comment: 'Current speed in km/h'
    },
    speedLimit: {
      type: DataTypes.DOUBLE,
      allowNull: false,
      defaultValue: 40,
      comment: 'Speed limit for the road in km/h'
    },
    rating: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1, max: 5 },
      comment: '1-5 star rating based on speed compliance'
    },
    lat: {
      type: DataTypes.DOUBLE,
      allowNull: false
    },
    lng: {
      type: DataTypes.DOUBLE,
      allowNull: false
    },
    roadName: {
      type: DataTypes.STRING(255),
      defaultValue: 'Unknown'
    }
  }, {
    tableName: 'speed_logs',
    timestamps: true
  });

  return SpeedLog;
};
