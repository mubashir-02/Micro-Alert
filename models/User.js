// ─── User Model (MySQL) ─────────────────────────────────────────────────────────
const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      defaultValue: 'Anonymous Driver'
    },
    email: {
      type: DataTypes.STRING(255),
      unique: true,
      allowNull: true
    },
    role: {
      type: DataTypes.ENUM('user', 'admin'),
      defaultValue: 'user'
    },
    currentLat: {
      type: DataTypes.DOUBLE,
      defaultValue: null
    },
    currentLng: {
      type: DataTypes.DOUBLE,
      defaultValue: null
    },
    speedRating: {
      type: DataTypes.DOUBLE,
      defaultValue: 5.0,
      comment: 'Average speed rating 1-5 stars'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    lastSeen: {
      type: DataTypes.DATE,
      defaultValue: DataTypes.NOW
    }
  }, {
    tableName: 'users',
    timestamps: true
  });

  return User;
};
