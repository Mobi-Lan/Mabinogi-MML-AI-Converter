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
        console.log(`[1/5] File uploaded: ${req.file.originalname}`);

        // Construct public URL for the uploaded file
        // Force HTTPS for Suno API (many APIs reject HTTP URLs)
        const protocol = 'https'; // Force HTTPS instead of req.protocol
        const host = req.get('host');
        const publicAudioUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
        console.log('[2/5] Public Audio URL:', publicAudioUrl);

        // Construct callback URL (required by Suno API)
        const callbackUrl = `${protocol}://${host}/api/suno-callback`;
        console.log('[2/5] Callback URL:', callbackUrl);

        console.log('[3/5] Sending request to Suno API...');

        // Use minimal required parameters according to API docs
        const requestBody = {
            uploadUrl: publicAudioUrl,
            customMode: true,
            instrumental: true,
            model: "V4",
            callBackUrl: callbackUrl,
            style: "Piano Solo, Faithful, No Improvisation", // More specific style
            title: "Piano Cover",
            audioWeight: 0.9, // High adherence to original audio (0.0 - 1.0)
            // weirdnessConstraint: 0.9 // High constraint on deviation (0.0 - 1.0) - Optional, trying audioWeight first
        };

        console.log('Request body:', JSON.stringify(requestBody, null, 2));

        const sunoResponse = await axios.post(`${SUNO_URL}/generate/upload-cover`, requestBody, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        console.log('Suno API Response:', JSON.stringify(sunoResponse.data, null, 2));

        // Extract taskId from response
        let taskId = null;
        const responseData = sunoResponse.data;

        if (responseData.data && responseData.data.taskId) {
            taskId = responseData.data.taskId;
        } else if (responseData.taskId) {
            taskId = responseData.taskId;
        }

        if (!taskId) {
            console.error("Failed to get taskId from Suno API");
            console.error("Full response:", JSON.stringify(sunoResponse.data, null, 2));
            throw new Error('No Task ID returned from Suno API');
        }

        console.log(`[3/5] Task started. ID: ${taskId}`);

        // Poll for completion using correct Suno API endpoint
        let audioUrl = null;
        let attempts = 0;
        const maxAttempts = 120; // 10 minutes (120 * 5s)

        console.log(`[4/5] Polling for task completion (max 10 minutes)...`);

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
            attempts++;

            try {
                // Query task status using correct endpoint for Music Generation
                // Endpoint: /api/v1/generate/record-info
                const statusResponse = await axios.get(`${SUNO_URL}/generate/record-info`, {
                    headers: { 'Authorization': `Bearer ${API_KEY}` },
                    params: { taskId: taskId }
                });

                console.log(`Polling attempt ${attempts}/${maxAttempts}`);

                const statusData = statusResponse.data;

                // Check API response code
                if (statusData.code !== 200) {
                    console.error('API error:', statusData);
                    continue;
                }

                const taskData = statusData.data;

                // Check if data is null
                if (!taskData) {
                    console.log('Task data is null, still processing...');
                    continue;
                }

                const status = taskData.status;
                console.log(`Task Status: ${status}`);

                if (status === 'SUCCESS' || status === 'FIRST_SUCCESS') {
                    console.log('[4/5] Task completed successfully!');

                    // Find audio URL in response.sunoData
                    if (taskData.response && taskData.response.sunoData && taskData.response.sunoData.length > 0) {
                        const track = taskData.response.sunoData[0];
                        audioUrl = track.audioUrl;
                    }

                    if (audioUrl) {
                        console.log('Found audio URL:', audioUrl);
                        break;
                    } else {
                        console.error('Task completed but no audio URL found');
                        throw new Error('No audio URL in completed task');
                    }
                } else if (status === 'GENERATE_AUDIO_FAILED' || status === 'CREATE_TASK_FAILED') {
                    throw new Error(`Suno generation failed: ${status}`);
                }
                // If PENDING or other status, continue polling

            } catch (pollError) {
                console.error(`Polling error (attempt ${attempts}):`, pollError.message);
                // Continue unless last attempt
                if (attempts >= maxAttempts) {
                    throw pollError;
                }
            }
        }

        if (!audioUrl) {
            throw new Error('Timeout waiting for generation (5 minutes)');
        }

        console.log(`[5/5] Downloading result: ${audioUrl}`);

        // Download the generated audio
        const resultResponse = await axios.get(audioUrl, { responseType: 'arraybuffer' });
        const resultFileName = `cover-${Date.now()}.mp3`;
        const resultPath = path.join('uploads', resultFileName);
        fs.writeFileSync(resultPath, resultResponse.data);

        // Cleanup original upload
        fs.unlinkSync(req.file.path);

        console.log('[5/5] Cover generated successfully!');

        res.json({
            success: true,
            message: "Cover generated successfully",
            coverUrl: `/uploads/${resultFileName}`
        });

    } catch (error) {
        console.error('=== SERVER ERROR ===');
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

// Callback endpoint for Suno API
app.post('/api/suno-callback', (req, res) => {
    console.log('=== Suno Callback Received ===');
    console.log(JSON.stringify(req.body, null, 2));
    res.json({ success: true });
});

// Export for Vercel serverless
module.exports = app;

// Start server only if running locally
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
