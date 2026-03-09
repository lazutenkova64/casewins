// ========== ИНИЦИАЛИЗАЦИЯ ПРИЛОЖЕНИЯ ==========
let isInitialized = false;
let loadingComplete = false;

async function init() {
    if (isInitialized) return;
    isInitialized = true;

    try {
        applyTheme(localStorage.getItem('theme') || 'classic-dark');
        loadMessageStatuses();
        
        callModal = document.getElementById('callModal');
        
        await Promise.all([
            preloadSounds(),
            checkCallsTable()
        ]);

        const { data: { session } } = await supabaseClient.auth.getSession();
        
        if (session?.user) {
            const { data: userData } = await supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .single();
            
            if (userData) {
                window.currentUser = {
                    id: userData.id,
                    name: userData.username,
                    avatar: userData.avatar || '👤',
                    bio: userData.bio || '',
                    isAdmin: userData.username === ADMIN_USERNAME,
                    dnd: userData.dnd || false
                };
                
                document.getElementById('loginModal').classList.remove('active');
                document.getElementById('appContainer').style.display = 'flex';
                
                updateProfileUI();
                
                await Promise.all([
                    loadAllUsers(),
                    loadUserChats(),
                    loadAllMessages()
                ]);
                
                await ensureSavedMessagesChat();
                
                loadPinnedChats();
                
                initAbly();
                startHeartbeat();
                startPresenceUpdates();
                startStatusUpdates();
                
                cleanupOldCalls();
                
                checkUrlForChat();
                forceShowInput();
                
                sendPendingMessages();
                processMessageQueue();
                
                listenForIncomingCalls();
                
                populateThemeGrid();
                
                if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
                    Notification.requestPermission();
                }
                
                if (myChats.length === 0) {
                    updateChatsList();
                }
                
                // Подписка на изменения сообщений в реальном времени
                supabaseClient
                  .channel('messages')
                  .on('INSERT', handleNewMessage)
                  .subscribe();
            } else {
                document.getElementById('loginModal').classList.add('active');
                document.getElementById('appContainer').style.display = 'none';
            }
        } else {
            document.getElementById('loginModal').classList.add('active');
            document.getElementById('appContainer').style.display = 'none';
        }
        
        setupMobileHandlers();
        updateBackButtonVisibility();
        updateCreateChatButtonVisibility();
        
        window.addEventListener('beforeunload', handleBeforeUnload);
        setInterval(forceShowInput, 1000);
        
        loadingComplete = true;
        
    } catch (err) {
        console.error('Init error:', err);
        document.getElementById('loginModal').classList.add('active');
        document.getElementById('appContainer').style.display = 'none';
        loadingComplete = true;
    }
}

async function handleBeforeUnload() {
    if (window.currentUser && ably) {
        await updateUserLastSeen();
        const presenceChannel = ably.channels.get('presence');
        if (presenceChannel.state === 'attached') {
            presenceChannel.presence.leave();
        }
    }
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
function generateUUID() {
    return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function formatLastSeen(timestamp) {
    if (!timestamp) return 'давно';
    
    const now = Date.now();
    const diff = now - timestamp;
    
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 30) return 'давно';
    if (seconds < 60) return 'только что';
    if (minutes < 60) {
        if (minutes === 1) return '1 мин назад';
        if (minutes >= 2 && minutes <= 4) return `${minutes} мин назад`;
        return `${minutes} мин назад`;
    }
    if (hours < 24) {
        if (hours === 1) return '1 час назад';
        if (hours >= 2 && hours <= 4) return `${hours} часа назад`;
        return `${hours} часов назад`;
    }
    if (days === 1) return 'вчера';
    if (days < 7) {
        if (days >= 2 && days <= 4) return `${days} дня назад`;
        return `${days} дней назад`;
    }
    
    const date = new Date(timestamp);
    return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatCallTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ========== АУДИО ==========
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let recordingTimeout;
let mediaStream = null;
let recordingStartTime = 0;
let activeAudio = null;
let activeAudioId = null;
let audioElements = {};
let audioUpdateInterval = null;

function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

function startRecording() {
    const messageInput = document.getElementById('messageInput');
    
    if (messageInput.value.trim().length > 0) {
        return;
    }
    
    if (!currentChat) {
        alert('Сначала выберите чат');
        return;
    }
    
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Ваш браузер не поддерживает запись аудио');
        return;
    }
    
    recordingStartTime = Date.now();
    
    navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
            mediaStream = stream;
            
            let mimeType = 'audio/webm';
            if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
                mimeType = 'audio/webm;codecs=opus';
            } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
                mimeType = 'audio/ogg;codecs=opus';
            }
            
            const options = { mimeType: mimeType };
            
            try {
                mediaRecorder = new MediaRecorder(stream, options);
            } catch (e) {
                mediaRecorder = new MediaRecorder(stream);
            }
            
            audioChunks = [];

            mediaRecorder.ondataavailable = event => {
                audioChunks.push(event.data);
            };

            mediaRecorder.onstop = async () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                const duration = Math.round((Date.now() - recordingStartTime) / 1000);
                
                if (mediaStream) {
                    mediaStream.getTracks().forEach(track => track.stop());
                    mediaStream = null;
                }
                
                if (audioBlob.size > 0 && duration > 0.1) {
                    await sendAudioMessage(audioBlob, duration);
                }
                
                document.getElementById('micBtn').classList.remove('recording');
            };

            mediaRecorder.start();
            isRecording = true;
            document.getElementById('micBtn').classList.add('recording');
            
            recordingTimeout = setTimeout(() => {
                if (isRecording) stopRecording();
            }, 60000);
        })
        .catch(err => {
            console.error('Microphone access error:', err);
            alert('Не удалось получить доступ к микрофону');
        });
}

function stopRecording() {
    if (!isRecording) return;
    
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        isRecording = false;
        
        if (recordingTimeout) {
            clearTimeout(recordingTimeout);
            recordingTimeout = null;
        }
    }
}

function toggleAudio(messageId, audioSrc) {
    if (!audioElements[messageId]) {
        try {
            audioElements[messageId] = new Audio(audioSrc);
            
            audioElements[messageId].ontimeupdate = () => updateAudioProgress(messageId);
            
            audioElements[messageId].onended = () => {
                updateAudioButton(messageId, false);
                updateAudioProgress(messageId);
            };
            
            audioElements[messageId].onpause = () => {
                updateAudioButton(messageId, false);
            };
            
            audioElements[messageId].onplay = () => {
                updateAudioButton(messageId, true);
            };
            
            audioElements[messageId].onerror = (e) => {
                console.error('Audio playback error:', e);
                alert('Ошибка воспроизведения аудио.');
            };
        } catch (e) {
            console.error('Error creating audio element:', e);
            alert('Не удалось создать аудио элемент');
            return;
        }
    }
    
    const audio = audioElements[messageId];
    
    if (activeAudioId === messageId && activeAudio) {
        if (!activeAudio.paused) {
            activeAudio.pause();
            updateAudioButton(messageId, false);
        } else {
            activeAudio.play().catch(e => {
                console.error('Play failed:', e);
                alert('Не удалось воспроизвести аудио');
            });
            updateAudioButton(messageId, true);
        }
        return;
    }
    
    if (activeAudio) {
        activeAudio.pause();
        activeAudio.currentTime = 0;
        updateAudioButton(activeAudioId, false);
    }
    
    activeAudio = audio;
    activeAudioId = messageId;
    
    activeAudio.play().catch(e => {
        console.error('Audio play error:', e);
        alert('Не удалось воспроизвести аудио');
    });
    updateAudioButton(messageId, true);
}

function updateAudioButton(messageId, isPlaying) {
    const btn = document.querySelector(`.play-pause-btn[data-message-id="${messageId}"]`);
    if (btn) {
        btn.innerHTML = isPlaying ? '⏸️' : '▶️';
        if (isPlaying) {
            btn.classList.add('playing');
        } else {
            btn.classList.remove('playing');
        }
    }
}

function updateAudioProgress(messageId) {
    const audio = audioElements[messageId];
    if (!audio) return;
    
    const progressFill = document.querySelector(`.audio-progress-fill[data-message-id="${messageId}"]`);
    const currentTimeSpan = document.querySelector(`.audio-current-time[data-message-id="${messageId}"]`);
    const durationSpan = document.querySelector(`.audio-duration[data-message-id="${messageId}"]`);
    
    if (progressFill) {
        const percent = (audio.currentTime / audio.duration) * 100 || 0;
        progressFill.style.width = percent + '%';
    }
    
    if (currentTimeSpan) {
        currentTimeSpan.textContent = formatTime(audio.currentTime);
    }
    
    if (durationSpan && audio.duration && !isNaN(audio.duration)) {
        durationSpan.textContent = formatTime(audio.duration);
    }
}

function seekAudio(messageId, event) {
    const audio = audioElements[messageId];
    if (!audio) return;
    
    const progressBar = event.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const percent = Math.max(0, Math.min(1, clickX / rect.width));
    audio.currentTime = percent * audio.duration;
    updateAudioProgress(messageId);
}

// ========== ОБРАБОТЧИКИ СОБЫТИЙ ==========
window.addEventListener('popstate', function(event) {
    const hash = window.location.hash.substring(1);
    if (hash) {
        const chat = myChats.find(c => c.id === hash) || publicChats.find(c => c.id === hash);
        if (chat) setTimeout(() => joinChat(chat), 500);
    } else {
        currentChat = null;
        renderMessages();
        updateUrlWithChat(null);
    }
});

window.addEventListener('resize', function() {
    updateBackButtonVisibility();
    if (window.innerWidth > 768) document.getElementById('sidebar').classList.remove('active');
    
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
    
    forceShowInput();
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeMediaViewer();
        hideMessageActions();
        if (callModal && callModal.classList.contains('active')) {
            endCall();
        }
    }
});

document.addEventListener('click', function(e) {
    const emojiPicker = document.getElementById('emojiPicker');
    const emojiBtn = document.querySelector('.emoji-toggle-btn');
    if (emojiPicker.style.display === 'flex' && !emojiPicker.contains(e.target) && !emojiBtn.contains(e.target)) {
        emojiPicker.style.display = 'none';
    }
});

document.getElementById('messageInput').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

document.addEventListener('DOMContentLoaded', () => {
    populateEmojiPicker();
    document.getElementById('loginModal').classList.add('active');
    init();
});
