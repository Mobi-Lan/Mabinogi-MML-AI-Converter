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
        const sunoResponse = await axios.post(`${SUNO_URL}/generate/upload-cover`, {
            uploadUrl: publicAudioUrl,
            callBackUrl: callbackUrl,
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
        const maxAttempts = 60; // 5 minutes (60 * 5s)

        console.log(`[4/5] Polling for task completion...`);

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5s
            attempts++;

            try {
                // Query task status - try with taskId in URL path
                const statusResponse = await axios.get(`${SUNO_URL}/suno/cover/record-info?taskId=${taskId}`, {
                    headers: { 'Authorization': `Bearer ${API_KEY}` }
                });

                console.log(`Polling attempt ${attempts}/${maxAttempts}`);

                const statusData = statusResponse.data;
                console.log('Status response:', JSON.stringify(statusData, null, 2));

                // Check API response code
                if (statusData.code !== 200) {
                    console.error('API error:', statusData);
                    continue;
                }

                const taskData = statusData.data;

                // Check if data is null (task not ready yet)
                if (!taskData) {
                    console.log('Task data is null, still processing...');
                    continue;
                }

                // successFlag: 1 = completed, 0 = processing, -1 = failed
                if (taskData.successFlag === 1) {
                    console.log('[4/5] Task completed successfully!');
                    console.log('Response:', JSON.stringify(taskData.response, null, 2));

                    // Find audio URL in response
                    if (taskData.response) {
                        if (taskData.response.audioUrl) {
                            audioUrl = taskData.response.audioUrl;
                        } else if (taskData.response.audio_url) {
                            audioUrl = taskData.response.audio_url;
                        } else if (taskData.response.url) {
                            audioUrl = taskData.response.url;
                        } else if (taskData.response.images && taskData.response.images.length > 0) {
                            // Check if first item is audio file
                            const firstUrl = taskData.response.images[0];
                            if (firstUrl.includes('.mp3') || firstUrl.includes('.wav') || firstUrl.includes('.ogg')) {
                                audioUrl = firstUrl;
                            }
                        }
                    }

                    if (audioUrl) {
                        console.log('Found audio URL:', audioUrl);
                        break;
                    } else {
                        console.error('Task completed but no audio URL found');
                        console.error('Full response:', JSON.stringify(taskData.response, null, 2));
                        throw new Error('No audio URL in completed task');
                    }
                } else if (taskData.successFlag === -1) {
                    const errorMsg = taskData.errorMessage || 'Unknown error';
                    throw new Error(`Suno generation failed: ${errorMsg}`);
                } else {
                    // Still processing
                    console.log(`Task still processing... (${attempts}/${maxAttempts})`);
                }
            } catch (pollError) {
                console.error(`Polling error (attempt ${attempts}):`, pollError.message);
                if (pollError.response) {
                    console.error('Status:', pollError.response.status);
                    console.error('Data:', pollError.response.data);
                }
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
