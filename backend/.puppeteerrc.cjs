const path = require('path');

module.exports = {
  cacheDirectory: process.env.PUPPETEER_CACHE_DIR || path.join(__dirname, 'node_modules', '.puppeteer_cache')
};
