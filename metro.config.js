const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Set maxWorkers: 0 to run transformation in-process (prevents Node 24 Windows DataCloneError)
config.maxWorkers = 0;

module.exports = config;
