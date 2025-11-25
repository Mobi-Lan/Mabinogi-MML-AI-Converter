const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SUNO_URL = process.env.SUNO_BASE_URL;
const API_KEY = process.env.SUNO_API_KEY;

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
    try {
        console.log(`[3/5] Requesting AI Cover generation...`);

        // Construct public URL for the uploaded file
        // NOTE: If running locally, Suno API cannot access 'localhost'. 
        // You need to use ngrok or deploy to a public server.
        const publicAudioUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
        console.log('Public Audio URL:', publicAudioUrl);

        console.log('Sending request to Suno API...');
        console.log('SUNO_URL:', SUNO_URL);
        console.log('API_KEY exists:', !!API_KEY);

        // Construct callback URL (optional, but API requires it)
        const callbackUrl = `${req.protocol}://${req.get('host')}/api/suno-callback`;

        const sunoResponse = await axios.post(`${SUNO_URL}/generate/upload-cover`, {
            uploadUrl: publicAudioUrl,
            callBackUrl: callbackUrl,  // Required by Suno API
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
        console.log('Suno API Response Headers:', JSON.stringify(sunoResponse.headers, null, 2));
        console.log('Suno API Response Data (full):', JSON.stringify(sunoResponse.data, null, 2));
        console.log('Response data type:', typeof sunoResponse.data);
        console.log('Response data keys:', Object.keys(sunoResponse.data || {}));

        // Parse response - try multiple possible formats
        let taskId = null;
        const responseData = sunoResponse.data;

        // Try different possible response structures
        if (responseData) {
            // Format 1: { data: { taskId: "..." } }
            if (responseData.data && responseData.data.taskId) {
                taskId = responseData.data.taskId;
                console.log('Found taskId in data.taskId:', taskId);
            }
            // Format 2: { taskId: "..." }
            else if (responseData.taskId) {
                taskId = responseData.taskId;
                console.log('Found taskId in taskId:', taskId);
            }
            // Format 3: { id: "..." }
            else if (responseData.id) {
                taskId = responseData.id;
                console.log('Found taskId in id:', taskId);
            }
            // Format 4: { data: { id: "..." } }
            else if (responseData.data && responseData.data.id) {
                taskId = responseData.data.id;
                console.log('Found taskId in data.id:', taskId);
            }
            // Format 5: { data: [{ id: "..." }] } (array format)
            else if (responseData.data && Array.isArray(responseData.data) && responseData.data.length > 0) {
                taskId = responseData.data[0].id || responseData.data[0].taskId;
                console.log('Found taskId in data array:', taskId);
            }
            // Format 6: Direct array [{ id: "..." }]
            else if (Array.isArray(responseData) && responseData.length > 0) {
                taskId = responseData[0].id || responseData[0].taskId;
                console.log('Found taskId in array:', taskId);
            }
        }

        if (!taskId) {
            console.error("=== FAILED TO FIND TASK ID ===");
            console.error("Full Suno Response:", JSON.stringify(sunoResponse.data, null, 2));
            console.error("Response structure:", JSON.stringify(Object.keys(sunoResponse.data || {})));
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

// Callback endpoint for Suno API (optional, for webhook notifications)
app.post('/api/suno-callback', (req, res) => {
    console.log('Suno callback received:', JSON.stringify(req.body, null, 2));
    res.json({ success: true });
});

// Export for Vercel serverless
module.exports = app;

// Start server only if running locally (not on Vercel)
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
