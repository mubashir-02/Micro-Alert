// ─── Risk Model (Sequelize - MySQL) ─────────────────────────────────────────────
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Risk = sequelize.define('Risk', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    type: {
      type: DataTypes.ENUM('sudden_brake', 'blind_turn', 'habitual_violation', 'accident'),
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
    severity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      validate: { min: 1, max: 5 }
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    timeOfDay: {
      type: DataTypes.ENUM('morning_rush', 'afternoon', 'evening_rush', 'night'),
      allowNull: false
    },
    weather: {
      type: DataTypes.ENUM('clear', 'rain', 'fog'),
      defaultValue: 'clear'
    },
    roadName: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    landmark: {
      type: DataTypes.STRING(255),
      defaultValue: ''
    },
    verified: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    cleared: {
      type: DataTypes.BOOLEAN,
      defaultValue: false
    },
    clearedAt: {
      type: DataTypes.DATE,
      defaultValue: null
    }
  }, {
    tableName: 'risks',
    timestamps: true
  });

  return Risk;
};
