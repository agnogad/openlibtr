require('dotenv').config();
const { start } = require('./src/app');

start().catch(err => {
    console.error("💥 Kritik Hata:", err.message);
    process.exit(1);
});

