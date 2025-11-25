const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const localtunnel = require('localtunnel');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SUNO_URL = process.env.SUNO_BASE_URL;
const API_KEY = process.env.SUNO_API_KEY;

let PUBLIC_URL = null; // Will be set by localtunnel

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve frontend files
app.use('/uploads', express.static('uploads')); // Serve uploaded files

// File Upload Setup
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// --- Suno AI Integration ---

app.post('/api/generate-cover', upload.single('audio'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No audio file uploaded' });
    }

    if (!PUBLIC_URL) {
        return res.status(503).json({
            error: 'Server is not ready yet. Public URL not available. Please wait a moment and try again.'
        });
    }

    try {
        console.log(`[3/5] Requesting AI Cover generation...`);

        // Construct public URL for the uploaded file using tunnel URL
        const publicAudioUrl = `${PUBLIC_URL}/uploads/${req.file.filename}`;
        console.log('Public Audio URL:', publicAudioUrl);

        console.log('Sending request to Suno API...');
        console.log('SUNO_URL:', SUNO_URL);
        console.log('API_KEY exists:', !!API_KEY);

        const sunoResponse = await axios.post(`${SUNO_URL}/generate/upload-cover`, {
            uploadUrl: publicAudioUrl,
            style: "Piano Solo, Clean, Acoustic",
            title: `Piano Cover - ${req.file.originalname}`,
            customMode: true,
            instrumental: true,
            model: "V5"
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Suno API Response Status:', sunoResponse.status);
        console.log('Suno API Response Data:', JSON.stringify(sunoResponse.data, null, 2));

        // Parse response according to Suno API documentation
        // Expected format: { code: 200, msg: "success", data: { taskId: "..." } }
        let taskId = null;
        if (sunoResponse.data.data && sunoResponse.data.data.taskId) {
            taskId = sunoResponse.data.data.taskId;
        } else if (sunoResponse.data.taskId) {
            taskId = sunoResponse.data.taskId;
        } else if (sunoResponse.data.id) {
            taskId = sunoResponse.data.id;
        }

        if (!taskId) {
            console.error("Full Suno Response:", JSON.stringify(sunoResponse.data, null, 2));
            throw new Error('No Task ID returned from Suno API. Check console for full response.');
        }
        console.log(`[3/5] Task started. ID: ${taskId}`);

        // 3. Poll for completion
        let audioUrl = null;
        let attempts = 0;
        const maxAttempts = 60; // 2 minutes

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s
            attempts++;

            const statusResponse = await axios.get(`${SUNO_URL}/get/${taskId}`, {
                headers: { 'Authorization': `Bearer ${API_KEY}` }
            });

            const status = statusResponse.data.status;
            console.log(`[4/5] Polling status: ${status} (${attempts}/${maxAttempts})`);

            if (status === 'completed' || status === 'succeeded') {
                if (statusResponse.data.clips && statusResponse.data.clips.length > 0) {
                    audioUrl = statusResponse.data.clips[0].audio_url;
                    break;
                }
            } else if (status === 'failed' || status === 'error') {
                throw new Error('Suno generation failed');
            }
        }

        if (!audioUrl) {
            throw new Error('Timeout waiting for generation');
        }

        console.log(`[5/5] Generation complete. Downloading: ${audioUrl}`);

        // 4. Download the result
        const resultResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
        const resultFileName = `cover-${Date.now()}.mp3`;
        const resultPath = path.join('uploads', resultFileName);
        fs.writeFileSync(resultPath, resultResponse.data);

        // Cleanup original upload
        fs.unlinkSync(req.file.path);

        res.json({
            success: true,
            message: "Cover generated successfully",
            coverUrl: `/uploads/${resultFileName}`
        });

    } catch (error) {
        console.error('--- SERVER ERROR ---');
        console.error(error);

        let errorMessage = error.message;
        let errorDetails = "";

        if (error.response) {
            console.error('API Response Data:', error.response.data);
            console.error('API Response Status:', error.response.status);
            errorDetails = JSON.stringify(error.response.data);
        }

        res.status(500).json({
            error: `Server Error: ${errorMessage}`,
            details: errorDetails
        });
    }
});

// Start server and localtunnel
async function startServer() {
    const server = app.listen(PORT, async () => {
        console.log(`Server running on http://localhost:${PORT}`);

        try {
            console.log('\n🚀 Starting localtunnel...');
            const tunnel = await localtunnel({ port: PORT });
            PUBLIC_URL = tunnel.url;

            console.log(`✅ Public URL: ${PUBLIC_URL}`);
            console.log(`\n📝 Use this URL to access your server from anywhere!`);
            console.log(`   Frontend: ${PUBLIC_URL}`);
            console.log(`   API: ${PUBLIC_URL}/api/generate-cover\n`);

            tunnel.on('close', () => {
                console.log('⚠️  Tunnel closed');
                PUBLIC_URL = null;
            });
        } catch (error) {
            console.error('❌ Failed to start localtunnel:', error.message);
            console.log('\n⚠️  Server is running on localhost only.');
            console.log('   The Suno API integration will NOT work without a public URL.\n');
        }
    });
}

startServer();
