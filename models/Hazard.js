// ─── Hazard Model (MySQL) ───────────────────────────────────────────────────────
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const Hazard = sequelize.define('Hazard', {
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
    type: {
      type: DataTypes.ENUM('construction', 'flood', 'accident', 'pothole', 'roadblock', 'other'),
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
    reportedAt: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    },
    active: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    tableName: 'hazards',
    timestamps: true
  });

  return Hazard;
};
