// Mabinogi MML Converter Logic (v8 - Suno AI Edition)

// Constants for Mabinogi MML
const MML_NOTES = ['c', 'c+', 'd', 'd+', 'e', 'f', 'f+', 'g', 'g+', 'a', 'a+', 'b'];
const MAX_VOLUME = 15; // Mabinogi volume is usually 0-15
const DEFAULT_OCTAVE = 4;
const DEFAULT_LENGTH = 4; // l4

let currentMidi = null;
let selectedFile = null;

document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('midi-input');
    const fileNameDisplay = document.getElementById('file-name');
    const controlsSection = document.getElementById('controls');
    const resultSection = document.getElementById('result-section');
    const trackList = document.getElementById('track-list');
    const convertBtn = document.getElementById('convert-btn');
    const startAnalysisBtn = document.getElementById('start-analysis-btn');
    const generateCoverBtn = document.getElementById('generate-cover-btn'); // New Button

    // File Upload Handling
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = '#fff';
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.style.borderColor = 'var(--primary-color)';
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--primary-color)';
        if (e.dataTransfer.files.length) {
            selectedFile = e.dataTransfer.files[0];
            fileNameDisplay.textContent = selectedFile.name;
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            selectedFile = e.target.files[0];
            fileNameDisplay.textContent = selectedFile.name;
            document.getElementById('song-title').value = selectedFile.name.replace(/\.[^/.]+$/, "");
        }
    });

    // --- Standard Analysis ---
    startAnalysisBtn.addEventListener('click', () => {
        if (selectedFile) {
            handleFile(selectedFile);
        } else {
            alert("먼저 파일을 업로드해주세요.");
        }
    });

    // --- AI Cover Generation (New) ---
    if (generateCoverBtn) {
        generateCoverBtn.addEventListener('click', async () => {
            if (!selectedFile) {
                alert("먼저 파일을 업로드해주세요.");
                return;
            }

            // UI Feedback
            generateCoverBtn.disabled = true;
            generateCoverBtn.textContent = "AI 피아노 커버 생성 중... (약 30초)";
            const loadingOverlay = document.getElementById('loading-overlay');
            const loadingText = document.getElementById('loading-text');
            const progressBar = document.getElementById('progress-bar');

            loadingOverlay.style.display = 'flex';
            loadingText.textContent = "서버로 파일 전송 중...";
            progressBar.style.width = '10%';

            try {
                // 1. Upload File
                const formData = new FormData();
                formData.append('audio', selectedFile);

                const response = await fetch('/api/generate-cover', {
                    method: 'POST',
                    body: formData
                });

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    throw new Error(errorData.error || `Server Error (${response.status})`);
                }

                const result = await response.json();

                if (result.success) {
                    loadingText.textContent = "커버 생성 완료! 분석 시작...";
                    progressBar.style.width = '50%';

                    // 2. Fetch the generated file
                    const coverResponse = await fetch(result.coverUrl);
                    const coverBlob = await coverResponse.blob();
                    const coverFile = new File([coverBlob], "AI_Cover_" + selectedFile.name, { type: "audio/mp3" });

                    // 3. Process as usual
                    await handleFile(coverFile);

                    generateCoverBtn.textContent = "AI 피아노 커버 생성 (Suno)";
                } else {
                    throw new Error(result.error || "Unknown error");
                }

            } catch (err) {
                console.error(err);
                alert("커버 생성 실패: " + err.message);
                loadingOverlay.style.display = 'none';
                generateCoverBtn.textContent = "AI 피아노 커버 생성 (Suno)";
            } finally {
                generateCoverBtn.disabled = false;
            }
        });
    }

    // Time Input Masking (mm:ss)
    const timeInputs = [
        document.getElementById('start-time'),
        document.getElementById('end-time'),
        document.getElementById('mml-start-time'),
        document.getElementById('mml-end-time')
    ];
    timeInputs.forEach(input => {
        if (!input) return;
        input.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\D/g, ''); // Remove non-digits
            if (value.length >= 3) {
                value = value.slice(0, 2) + ':' + value.slice(2, 4);
            }
            e.target.value = value;
        });
    });

    function parseTime(timeStr) {
        if (!timeStr || !timeStr.includes(':')) return null;
        const parts = timeStr.split(':');
        const min = parseInt(parts[0]) || 0;
        const sec = parseInt(parts[1]) || 0;
        return min * 60 + sec;
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    async function handleFile(file) {
        fileNameDisplay.textContent = file.name;
        const loadingOverlay = document.getElementById('loading-overlay');
        const loadingText = document.getElementById('loading-text');
        const progressBar = document.getElementById('progress-bar');
        const progressPercent = document.getElementById('progress-percent');

        const setProgress = (percent, msg) => {
            progressBar.style.width = `${percent}%`;
            progressPercent.textContent = `${percent}%`;
            if (msg) loadingText.textContent = msg;
        };

        try {
            if (file.name.match(/\.(mid|midi)$/i)) {
                // Handle MIDI
                const arrayBuffer = await file.arrayBuffer();
                currentMidi = new Midi(arrayBuffer);
                processMidiLoaded();
            } else if (file.name.match(/\.(mp3|wav|ogg|mp4)$/i)) {
                // Handle Audio (MP3/WAV/MP4) with Chunking
                loadingOverlay.style.display = 'flex';
                setProgress(0, "준비 중...");

                // 1. Initialize Model
                setProgress(5, "AI 모델 로딩 중...");
                const model = new mm.OnsetsAndFrames('https://storage.googleapis.com/magentadata/js/checkpoints/transcription/onsets_frames_uni');
                await model.initialize();
                setProgress(15, "오디오 디코딩 중...");

                // 2. Decode Audio
                const arrayBuffer = await file.arrayBuffer();
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const originalBuffer = await audioContext.decodeAudioData(arrayBuffer);

                // --- Optimization: Slice BEFORE Resampling ---
                // Parse User Range immediately
                const userStart = parseTime(document.getElementById('start-time').value);
                const userEnd = parseTime(document.getElementById('end-time').value);
                const totalDuration = originalBuffer.duration;

                const effectiveStart = (userStart !== null && userStart < totalDuration) ? userStart : 0;
                const effectiveEnd = (userEnd !== null && userEnd > effectiveStart && userEnd <= totalDuration) ? userEnd : totalDuration;

                // Slice the buffer
                const slicedBuffer = sliceAudioBuffer(audioContext, originalBuffer, effectiveStart, effectiveEnd);

                // --- Optimization: Resample to 16kHz (Only the sliced part) ---
                setProgress(18, "오디오 최적화 중 (16kHz 리샘플링)...");
                const audioBuffer = await resampleTo16k(slicedBuffer);

                // 3. Chunking & Transcription
                const CHUNK_DURATION = 15;
                // Now the audioBuffer is ALREADY the cut version, so duration is the cut length
                const rangeDuration = audioBuffer.duration;
                const totalChunks = Math.ceil(rangeDuration / CHUNK_DURATION);
                let fullNotes = [];

                setProgress(20, `변환 시작... (${formatTime(effectiveStart)} ~ ${formatTime(effectiveEnd)})`);

                for (let i = 0; i < totalChunks; i++) {
                    const startTime = i * CHUNK_DURATION; // Relative to the sliced buffer (starts at 0)
                    const endTime = Math.min(startTime + CHUNK_DURATION, rangeDuration);

                    // Create chunk buffer
                    const sampleRate = audioBuffer.sampleRate; // 16000
                    const startSample = Math.floor(startTime * sampleRate);
                    const endSample = Math.floor(endTime * sampleRate);
                    const frameCount = endSample - startSample;

                    if (frameCount <= 0) continue;

                    const chunkBuffer = audioContext.createBuffer(
                        audioBuffer.numberOfChannels,
                        frameCount,
                        sampleRate
                    );

                    // Copy data
                    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
                        const channelData = audioBuffer.getChannelData(ch).subarray(startSample, endSample);
                        chunkBuffer.copyToChannel(channelData, ch);
                    }

                    // Transcribe chunk
                    const ns = await model.transcribeFromAudioBuffer(chunkBuffer);

                    // Offset and merge notes
                    ns.notes.forEach(note => {
                        fullNotes.push({
                            pitch: note.pitch,
                            startTime: note.startTime + startTime, // Relative to sliced start
                            endTime: note.endTime + startTime,
                            velocity: note.velocity
                        });
                    });

                    // Update Progress
                    const percent = 20 + Math.round(((i + 1) / totalChunks) * 80);
                    setProgress(percent, `변환 중... (${i + 1}/${totalChunks} 구간 완료)`);
                }

                setProgress(100, "변환 완료! 마무리 중...");

                // Notes are already relative to the start of the slice (0), so no offset needed.
                const combinedNS = { notes: fullNotes };

                // Convert NoteSequence to Tone.js Midi-like structure
                currentMidi = convertNoteSequenceToMidiStruct(combinedNS);

                loadingOverlay.style.display = 'none';
                processMidiLoaded();

            } else {
                alert("지원하지 않는 파일 형식입니다.");
            }
        } catch (err) {
            console.error(err);
            loadingOverlay.style.display = 'none';
            alert("파일 처리 중 오류가 발생했습니다: " + err.message);
        }
    }

    function sliceAudioBuffer(context, buffer, start, end) {
        const rate = buffer.sampleRate;
        const startOffset = Math.floor(start * rate);
        const endOffset = Math.floor(end * rate);
        const frameCount = endOffset - startOffset;

        if (frameCount <= 0) return buffer;

        const newBuffer = context.createBuffer(buffer.numberOfChannels, frameCount, rate);
        for (let i = 0; i < buffer.numberOfChannels; i++) {
            const channelData = buffer.getChannelData(i).subarray(startOffset, endOffset);
            newBuffer.copyToChannel(channelData, i);
        }
        return newBuffer;
    }

    async function resampleTo16k(audioBuffer) {
        if (audioBuffer.sampleRate === 16000) return audioBuffer;

        const offlineCtx = new OfflineAudioContext(
            audioBuffer.numberOfChannels,
            audioBuffer.duration * 16000,
            16000
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineCtx.destination);
        source.start();

        return await offlineCtx.startRendering();
    }


    function convertNoteSequenceToMidiStruct(ns) {
        // Create a fake Midi structure compatible with our existing code
        const notes = ns.notes.map(n => ({
            midi: n.pitch,
            time: n.startTime,
            duration: n.endTime - n.startTime,
            velocity: n.velocity / 100 // Normalize to 0-1 roughly
        }));

        // Sort by time
        notes.sort((a, b) => a.time - b.time);

        return {
            header: { tempos: [{ bpm: 120 }] }, // Default BPM, Magenta output is usually time-based
            tracks: [
                { name: "AI Transcribed Piano", notes: notes }
            ]
        };
    }

    function processMidiLoaded() {
        console.log("MIDI Loaded:", currentMidi);

        // Auto-detect BPM
        const bpm = (currentMidi.header && currentMidi.header.tempos && currentMidi.header.tempos.length > 0)
            ? Math.round(currentMidi.header.tempos[0].bpm)
            : 120;
        document.getElementById('bpm-input').value = bpm;

        renderTrackList(currentMidi.tracks);
        controlsSection.style.display = 'block';
        resultSection.style.display = 'none';
        document.getElementById('error-display').style.display = 'none'; // Reset error display
    }

    function renderTrackList(tracks) {
        trackList.innerHTML = '';

        tracks.forEach((track, index) => {
            if (track.notes.length === 0) return; // Skip empty tracks

            const div = document.createElement('div');
            div.className = 'track-item';

            // Default all to "Include"
            div.innerHTML = `
                <span>Track ${index + 1}: ${track.name || 'Untitled'} (${track.notes.length} notes)</span>
                <select data-track-index="${index}">
                    <option value="include" selected>변환 포함</option>
                    <option value="none">사용 안 함</option>
                </select>
            `;
            trackList.appendChild(div);
        });
    }

    function updateResult(melody, harmony1, harmony2) {
        document.getElementById('mml-melody').value = melody;
        document.getElementById('mml-harmony1').value = harmony1;
        document.getElementById('mml-harmony2').value = harmony2;

        // Update Character Counts
        document.getElementById('count-melody').textContent = `${melody.length} / 1200`;
        document.getElementById('count-harmony1').textContent = `${harmony1.length} / 1200`;
        document.getElementById('count-harmony2').textContent = `${harmony2.length} / 1200`;

        // Color warning if > 1200
        [
            { id: 'count-melody', len: melody.length },
            { id: 'count-harmony1', len: harmony1.length },
            { id: 'count-harmony2', len: harmony2.length }
        ].forEach(item => {
            const el = document.getElementById(item.id);
            if (item.len > 1200) {
                el.style.color = 'red';
                el.style.fontWeight = 'bold';
            } else {
                el.style.color = '#888';
                el.style.fontWeight = 'normal';
            }
        });

        resultSection.style.display = 'block';
    }

    convertBtn.addEventListener('click', () => {
        if (!currentMidi) return;

        const selects = trackList.querySelectorAll('select');
        let allNotes = [];
        let hasSelection = false;

        selects.forEach(select => {
            if (select.value !== 'none') {
                const trackIndex = parseInt(select.dataset.trackIndex);
                const track = currentMidi.tracks[trackIndex];

                // 1. Filter & Sanitize
                // Read User Settings
                const userMinDur = parseInt(document.getElementById('min-duration').value) || 50;
                const userMinVel = parseInt(document.getElementById('min-velocity').value) || 10;

                const MIN_DURATION = userMinDur / 1000; // ms to seconds
                const MIN_VELOCITY = userMinVel / 100;  // % to 0-1

                track.notes.forEach(note => {
                    const duration = parseFloat(note.duration) || 0;
                    const velocity = parseFloat(note.velocity) || 0;

                    // Filter noise (too short or too quiet)
                    if (duration < MIN_DURATION || velocity < MIN_VELOCITY) return;

                    allNotes.push({
                        ...note,
                        time: parseFloat(note.time) || 0,
                        duration: duration,
                        velocity: velocity,
                        originalTrack: trackIndex
                    });
                });
                hasSelection = true;
            }
        });

        if (!hasSelection) {
            alert("변환할 트랙을 하나 이상 선택해주세요.");
            return;
        }

        // --- User Inputs ---
        // 1. BPM (User override or MIDI default)
        const userBpm = parseInt(document.getElementById('bpm-input').value) || 120;

        // 2. Quantization Level
        const quantizeVal = parseInt(document.getElementById('quantization-select').value);

        // --- Quantization & Error Calculation ---
        let totalError = 0;
        let noteCount = 0;

        if (quantizeVal > 0) {
            // 60 / BPM = 1 Beat (1/4 note)
            // 1/32 note = 1 Beat / 8
            // 1/64 note = 1 Beat / 16
            // 1/128 note = 1 Beat / 32
            let div = 8;
            if (quantizeVal === 64) div = 16;
            if (quantizeVal === 128) div = 32;

            const tickDuration = (60 / userBpm) / div;

            allNotes.forEach(note => {
                const originalTime = note.time;

                // Snap time
                note.time = Math.round(note.time / tickDuration) * tickDuration;

                // Snap duration (min 1 tick)
                let quantizedDuration = Math.round(note.duration / tickDuration) * tickDuration;
                if (quantizedDuration < tickDuration) quantizedDuration = tickDuration;
                note.duration = quantizedDuration;

                // Calculate Error (Time difference in ms)
                totalError += Math.abs(note.time - originalTime);
                noteCount++;
            });
        }

        // Display Error
        const errorDisplay = document.getElementById('error-display');
        if (noteCount > 0) {
            const avgErrorMs = (totalError / noteCount) * 1000;
            if (avgErrorMs > 30) {
                errorDisplay.style.display = 'block';
                errorDisplay.textContent = `⚠️ 평균 박자 오차: ${avgErrorMs.toFixed(1)}ms (BPM이 맞지 않을 수 있습니다)`;
            } else {
                errorDisplay.style.display = 'block';
                errorDisplay.style.color = '#4caf50'; // Green
                errorDisplay.textContent = `✅ 평균 박자 오차: ${avgErrorMs.toFixed(1)}ms (양호)`;
            }
        } else {
            errorDisplay.style.display = 'none';
        }

        // 2. Sort: Time ASC -> Pitch DESC (Top-Note Priority)
        allNotes.sort((a, b) => {
            if (Math.abs(a.time - b.time) < 0.0001) {
                return b.midi - a.midi; // Higher pitch first (Melody Priority)
            }
            return a.time - b.time;
        });

        // --- MML Range Slicing ---
        const mmlStartStr = document.getElementById('mml-start-time').value;
        const mmlEndStr = document.getElementById('mml-end-time').value;

        let mmlStart = parseTime(mmlStartStr);
        let mmlEnd = parseTime(mmlEndStr);

        // If user didn't input, default to full range
        if (mmlStart === null) mmlStart = 0;
        if (mmlEnd === null) mmlEnd = 999999;

        // Filter notes within MML range
        allNotes = allNotes.filter(n => n.time >= mmlStart && n.time <= mmlEnd);

        // Shift times to start at 0
        if (allNotes.length > 0 && mmlStart > 0) {
            allNotes.forEach(n => {
                n.time -= mmlStart;
            });
        }

        // 2.5 Legato Smoothing (Merge same-pitch notes that are close)
        const MERGE_THRESHOLD = 0.05; // 50ms gap allowed
        const mergedNotes = [];
        if (allNotes.length > 0) {
            let current = allNotes[0];
            for (let i = 1; i < allNotes.length; i++) {
                const next = allNotes[i];
                // Check if same pitch and close enough
                if (current.midi === next.midi &&
                    (next.time - (current.time + current.duration)) < MERGE_THRESHOLD) {
                    // Merge
                    current.duration = (next.time + next.duration) - current.time;
                    // Keep higher velocity? or average? Let's keep max.
                    current.velocity = Math.max(current.velocity, next.velocity);
                } else {
                    mergedNotes.push(current);
                    current = next;
                }
            }
            mergedNotes.push(current);
            allNotes = mergedNotes;
        }

        // Distribute to 3 lanes (Melody, Harm1, Harm2)
        const lanes = [
            { name: 'melody', notes: [], endTime: 0 },
            { name: 'harmony1', notes: [], endTime: 0 },
            { name: 'harmony2', notes: [], endTime: 0 }
        ];

        let droppedCount = 0;
        const CHORD_THRESHOLD = 0.02; // Notes closer than 20ms are chords

        allNotes.forEach(note => {
            // Safety check for time/duration
            const nTime = parseFloat(note.time) || 0;
            const nDuration = parseFloat(note.duration) || 0;

            let assigned = false;

            for (let i = 0; i < lanes.length; i++) {
                const lane = lanes[i];
                const lastNote = lane.notes.length > 0 ? lane.notes[lane.notes.length - 1] : null;

                // Case 1: Empty Lane -> Assign
                if (!lastNote) {
                    lane.notes.push({ ...note, time: nTime, duration: nDuration });
                    assigned = true;
                    break;
                }

                // Case 2: Chord (Starts at same time as last note) -> Skip this lane
                if (Math.abs(nTime - lastNote.time) < CHORD_THRESHOLD) {
                    continue; // Try next lane
                }

                // Case 3: Legato / Sequence (Starts after last note)
                // If overlap, truncate the previous note
                if (nTime < lastNote.time + lastNote.duration) {
                    // Truncate last note
                    lastNote.duration = nTime - lastNote.time;
                    // Prevent zero/negative duration (shouldn't happen due to sort, but safety)
                    if (lastNote.duration < 0.01) lastNote.duration = 0.01;
                }

                // Assign new note
                lane.notes.push({ ...note, time: nTime, duration: nDuration });
                assigned = true;
                break;
            }

            if (!assigned) droppedCount++;
        });

        // 3. Read Volume Settings
        const volMelody = parseInt(document.getElementById('vol-melody').value) || 15;
        const volHarmony1 = parseInt(document.getElementById('vol-harmony1').value) || 15;
        const volHarmony2 = parseInt(document.getElementById('vol-harmony2').value) || 15;

        const mmlOutput = {
            melody: convertNotesToMML(lanes[0].notes, volMelody, userBpm),
            harmony1: convertNotesToMML(lanes[1].notes, volHarmony1, userBpm),
            harmony2: convertNotesToMML(lanes[2].notes, volHarmony2, userBpm)
        };

        updateResult(mmlOutput.melody, mmlOutput.harmony1, mmlOutput.harmony2);
    });

    // Robust Copy Function
    async function copyToClipboard(text, buttonElement) {
        const originalText = buttonElement.textContent;

        try {
            // Try Modern Async API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                showSuccess(buttonElement, originalText);
            } else {
                throw new Error("Clipboard API unavailable");
            }
        } catch (err) {
            // Fallback for Android/Older Browsers
            try {
                const textArea = document.createElement("textarea");
                textArea.value = text;

                // Ensure it's not visible but part of DOM
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                textArea.style.top = "0";
                document.body.appendChild(textArea);

                textArea.focus();
                textArea.select();

                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);

                if (successful) {
                    showSuccess(buttonElement, originalText);
                } else {
                    alert("복사에 실패했습니다. 텍스트를 직접 선택해서 복사해주세요.");
                }
            } catch (fallbackErr) {
                console.error("Copy failed:", fallbackErr);
                alert("복사 기능을 사용할 수 없습니다.");
            }
        }
    }

    function showSuccess(buttonElement, originalText) {
        buttonElement.textContent = '복사됨!';
        buttonElement.style.backgroundColor = '#4caf50'; // Green feedback
        setTimeout(() => {
            buttonElement.textContent = originalText;
            buttonElement.style.backgroundColor = ''; // Reset color
        }, 2000);
    }

    // Copy Buttons for individual textareas
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const textarea = document.getElementById(targetId);
            copyToClipboard(textarea.value, btn);
        });
    });

    const createBtn = document.getElementById('create-song-btn');
    createBtn.addEventListener('click', () => {
        const m = document.getElementById('mml-melody').value;
        const h1 = document.getElementById('mml-harmony1').value;
        const h2 = document.getElementById('mml-harmony2').value;
        if (!m && !h1 && !h2) {
            alert("변환된 내용이 없습니다.");
            return;
        }
        const full = `MML@${m},${h1},${h2};`;
        copyToClipboard(full, createBtn);
    });
});

// --- Core Conversion Logic ---

function convertNotesToMML(allNotes, maxVolume = 15, bpm = 120) {
    if (!allNotes || allNotes.length === 0) return "MML@;";

    // Sort by time (just in case)
    allNotes.sort((a, b) => a.time - b.time);

    if (allNotes.length === 0) return "MML@;";

    // --- Optimization: Find Best Default Length (l) ---
    const durationCounts = {};
    let maxCount = 0;
    let bestLength = "4"; // Default fallback

    allNotes.forEach(note => {
        const parts = getDurationParts(note.duration, bpm);
        if (parts.length > 0) {
            const len = parts[0]; // Count the first part (main duration)
            durationCounts[len] = (durationCounts[len] || 0) + 1;
            if (durationCounts[len] > maxCount) {
                maxCount = durationCounts[len];
                bestLength = len;
            }
        }
    });

    let mml = `MML@t${Math.round(bpm)}l${bestLength}`;
    let currentOctave = DEFAULT_OCTAVE;
    let currentVolume = -1; // Force initial volume set
    let currentTime = 0;

    allNotes.forEach((note, index) => {
        // 1. Handle Rests
        if (note.time > currentTime + 0.01) { // Tolerance
            const restDuration = note.time - currentTime;
            const restParts = getDurationParts(restDuration, bpm);
            restParts.forEach(part => {
                mml += "r" + (part === bestLength ? "" : part);
            });
        }

        // 2. Handle Volume
        // Map velocity (0-1) to MML volume (0-maxVolume)
        // Mabinogi limit is 15. If maxVolume > 15, it acts as a boost/compressor.
        let vol = Math.round(note.velocity * maxVolume);
        if (vol > 15) vol = 15; // Clamp to Mabinogi limit
        if (vol < 0) vol = 0;

        if (vol !== currentVolume) {
            mml += "v" + vol;
            currentVolume = vol;
        }

        // 3. Handle Octave
        const targetOctave = Math.floor(note.midi / 12) - 1;
        if (targetOctave !== currentOctave) {
            if (targetOctave > currentOctave) {
                mml += ">".repeat(targetOctave - currentOctave);
            } else {
                mml += "<".repeat(currentOctave - targetOctave);
            }
            currentOctave = targetOctave;
        }

        // 3. Handle Note
        const noteName = MML_NOTES[note.midi % 12];
        const durationParts = getDurationParts(note.duration, bpm);

        if (durationParts.length > 0) {
            // First part: check against default length
            const firstPart = durationParts[0];
            mml += noteName + (firstPart === bestLength ? "" : firstPart);

            // Tied parts
            for (let i = 1; i < durationParts.length; i++) {
                const part = durationParts[i];
                mml += "&" + noteName + (part === bestLength ? "" : part);
            }
        }

        currentTime = note.time + note.duration;
    });

    mml += ";";
    return mml;
}

function getDurationParts(seconds, bpm) {
    const beatDuration = 60 / bpm;
    const wholeNoteDuration = beatDuration * 4;

    // Convert to 64th note ticks (Mabinogi smallest unit usually)
    // 64th note duration = wholeNoteDuration / 64
    const tickDuration = wholeNoteDuration / 64;
    let ticks = Math.round(seconds / tickDuration);

    if (ticks <= 0) return [];

    const lengthMap = [
        { val: 64, mml: "1" },
        { val: 48, mml: "2." },
        { val: 32, mml: "2" },
        { val: 24, mml: "4." },
        { val: 16, mml: "4" },
        { val: 12, mml: "8." },
        { val: 8, mml: "8" },
        { val: 6, mml: "16." },
        { val: 4, mml: "16" },
        { val: 3, mml: "32." },
        { val: 2, mml: "32" },
        { val: 1, mml: "64" }
    ];

    let parts = [];

    while (ticks > 0) {
        let found = false;
        for (let i = 0; i < lengthMap.length; i++) {
            if (ticks >= lengthMap[i].val) {
                parts.push(lengthMap[i].mml);
                ticks -= lengthMap[i].val;
                found = true;
                break;
            }
        }
        if (!found) break;
    }

    return parts;
}
