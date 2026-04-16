// ─── Sequelize Database Connection & Models ─────────────────────────────────────
const { Sequelize } = require('sequelize');

function parseBoolean(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function buildSequelizeConfig() {
  const logging = parseBoolean(process.env.DB_LOGGING, false);
  const sslEnabled = parseBoolean(process.env.MYSQL_SSL, false);
  const commonOptions = {
    dialect: 'mysql',
    logging,
    pool: {
      max: 10,
      min: 0,
      acquire: 30000,
      idle: 10000
    },
    define: {
      timestamps: true,
      underscored: false
    }
  };

  if (process.env.DATABASE_URL) {
    return new Sequelize(process.env.DATABASE_URL, {
      ...commonOptions,
      dialectOptions: sslEnabled
        ? {
            ssl: {
              require: true,
              rejectUnauthorized: false
            }
          }
        : undefined
    });
  }

  return new Sequelize(
    process.env.MYSQL_DB || 'microalert',
    process.env.MYSQL_USER || 'root',
    process.env.MYSQL_PASSWORD || '1234',
    {
      ...commonOptions,
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      dialectOptions: sslEnabled
        ? {
            ssl: {
              require: true,
              rejectUnauthorized: false
            }
          }
        : undefined
    }
  );
}

const sequelize = buildSequelizeConfig();

// ─── Import Models ──────────────────────────────────────────────────────────────
const Risk = require('./Risk')(sequelize);
const Hazard = require('./Hazard')(sequelize);
const EmergencyDispatch = require('./EmergencyDispatch')(sequelize);
const SpeedLog = require('./SpeedLog')(sequelize);
const Accident = require('./Accident')(sequelize);
const User = require('./User')(sequelize);

// ─── Associations ───────────────────────────────────────────────────────────────
// EmergencyDispatch belongs to User
EmergencyDispatch.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(EmergencyDispatch, { foreignKey: 'userId', as: 'dispatches' });

// SpeedLog belongs to User
SpeedLog.belongsTo(User, { foreignKey: 'userId', as: 'user' });
User.hasMany(SpeedLog, { foreignKey: 'userId', as: 'speedLogs' });

module.exports = {
  sequelize,
  Sequelize,
  Risk,
  Hazard,
  EmergencyDispatch,
  SpeedLog,
  Accident,
  User
};
