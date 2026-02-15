const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // Keeps connections alive
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000 // 10 seconds
});

async function initializeDatabase() {
    try {
        const connection = await pool.getConnection();
        connection.release();
        console.log('Database connection pool initialized successfully');

        // 테이블 자동 생성 (없으면 생성, 있으면 무시)
        await pool.execute(`
            CREATE TABLE IF NOT EXISTS survey_consent (
                id INT AUTO_INCREMENT PRIMARY KEY,
                survey_id VARCHAR(11) NOT NULL,
                version INT NOT NULL DEFAULT 1,
                privacy_consent VARCHAR(20) NOT NULL COMMENT 'all/hallym/this_research/none',
                consent1 TINYINT NOT NULL DEFAULT 0,
                consent2 TINYINT NOT NULL DEFAULT 0,
                consent3 TINYINT NOT NULL DEFAULT 0,
                consent4 TINYINT NOT NULL DEFAULT 0,
                consent5 TINYINT NOT NULL DEFAULT 0,
                consent6 TINYINT NOT NULL DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                KEY idx_survey_id (survey_id),
                KEY idx_survey_version (survey_id, version)
            );
        `);

        return pool;
    } catch (error) {
        console.error('Database connection failed:', error);
        throw error;
    }
}


// async function initializeDatabase() {
//     const connection = await mysql.createConnection({
//         host: 'localhost',
//         user: 'root', // Replace with your database username
//         password: 'lpdn3740!', // Replace with your database password
//         database: 'question_ppd'
//     });
    
//     await connection.execute(`
//         CREATE TABLE IF NOT EXISTS fft_data (
//             id INT AUTO_INCREMENT PRIMARY KEY,
//             primaryHand VARCHAR(10) NOT NULL,
//             survey_id VARCHAR(255) NOT NULL,
//             x FLOAT NOT NULL,
//             y FLOAT NOT NULL,
//             validity TINYINT NOT NULL,
//             box_type VARCHAR(50) NOT NULL,
//             time INT NOT NULL,
//             version VARCHAR(10) NOT NULL,
//             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//         );
//     `);

//     await connection.execute(`
//         CREATE TABLE IF NOT EXISTS fft_metadata (
//             id INT AUTO_INCREMENT PRIMARY KEY,
//             survey_id VARCHAR(255) NOT NULL,
//             version VARCHAR(10) NOT NULL,
//             total_taps INT NOT NULL,
//             tap_intervals JSON NOT NULL,
//             cvtap_inter FLOAT DEFAULT NULL,
//             meantap_inter FLOAT DEFAULT NULL,
//             mediantap_inter FLOAT DEFAULT NULL,
//             abnormal TINYINT DEFAULT 0,
//             abnormal_probability FLOAT DEFAULT 0,
//             ftt_weight FLOAT DEFAULT 0,
//             created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
//         );
//     `);

//     console.log('Database initialized and tables ensured.');
//     return connection;
// }
module.exports = initializeDatabase;
