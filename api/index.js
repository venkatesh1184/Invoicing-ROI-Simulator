const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const path = require('path'); // We need this to find files
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- Database Connection ---
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }
};

// --- Internal Constants ---
const AUTOMATED_COST_PER_INVOICE = 0.20;
const ERROR_RATE_AUTO = 0.001; // 0.1%
const MIN_ROI_BOOST_FACTOR = 1.1;

// --- Calculation Logic (no changes here) ---
const calculateRoi = (data) => {
    const d = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, parseFloat(v) || 0]));
    const labor_cost_manual = (d.num_ap_staff * d.hourly_wage * d.avg_hours_per_invoice * d.monthly_invoice_volume);
    const auto_cost = d.monthly_invoice_volume * AUTOMATED_COST_PER_INVOICE;
    const error_savings = ((d.error_rate_manual / 100) - ERROR_RATE_AUTO) * d.monthly_invoice_volume * d.error_cost;
    let monthly_savings = (labor_cost_manual + error_savings) - auto_cost;
    monthly_savings *= MIN_ROI_BOOST_FACTOR;

    if (monthly_savings <= 0) return { monthly_savings: Math.round(monthly_savings), payback_months: Infinity, net_savings: -d.one_time_implementation_cost, roi_percentage: -100 };
    
    const implementation_cost = d.one_time_implementation_cost;
    const payback_months = implementation_cost > 0 ? implementation_cost / monthly_savings : 0;
    const net_savings = (monthly_savings * d.time_horizon_months) - implementation_cost;
    const roi_percentage = implementation_cost > 0 ? (net_savings / implementation_cost) * 100 : Infinity;

    return { monthly_savings: Math.round(monthly_savings), payback_months: Math.round(payback_months * 10) / 10, net_savings: Math.round(net_savings), roi_percentage: Math.round(roi_percentage) };
};

// --- API Routes ---
// This is the new part that serves your homepage
app.get('/', (req, res) => {
    // This finds the index.html file in your 'public' folder
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Serve other static files like CSS or images if you had them
app.use(express.static(path.join(__dirname, '../public')));


app.post('/api/simulate', (req, res) => res.json(calculateRoi(req.body)));

app.get('/api/scenarios', async (req, res) => {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        const [rows] = await connection.execute('SELECT * FROM scenarios ORDER BY id');
        res.json(rows);
    } catch (err) { res.status(500).json({ error: 'Database error: ' + err.message }); }
    finally { if (connection) connection.end(); }
});

app.post('/api/scenarios', async (req, res) => {
    let connection;
    try {
        const s = req.body;
        connection = await mysql.createConnection(dbConfig);
        const sql = `INSERT INTO scenarios (scenario_name, monthly_invoice_volume, num_ap_staff, avg_hours_per_invoice, hourly_wage, error_rate_manual, error_cost, time_horizon_months, one_time_implementation_cost) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        const values = [s.scenario_name, s.monthly_invoice_volume, s.num_ap_staff, s.avg_hours_per_invoice, s.hourly_wage, s.error_rate_manual, s.error_cost, s.time_horizon_months, s.one_time_implementation_cost];
        const [result] = await connection.execute(sql, values);
        res.status(201).json({ id: result.insertId, ...s });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Scenario name already exists.' });
        res.status(500).json({ error: 'Database insert failed: ' + err.message });
    } finally { if (connection) connection.end(); }
});

// Vercel needs this export
module.exports = app;