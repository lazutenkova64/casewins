// Состояние звонка
let currentCall = null;
let localStream = null;
let peerConnection = null;
let callMuted = false;
let callTimerInterval = null;
let callStartTime = null;
const CALL_DURATION_LIMIT = 30 * 60 * 1000; // 30 минут

let callsTableExists = true;

// Аудио элементы
let ringtoneAudio = null;
let acceptedAudio = null;
let endedAudio = null;

// Инициализация звуков
async function initSounds() {
    return new Promise((resolve) => {
        ringtoneAudio = document.getElementById('ringtone');
        acceptedAudio = document.getElementById('call-accepted');
        endedAudio = document.getElementById('call-ended');
        
        // Проверяем, что элементы существуют
        if (!ringtoneAudio || !acceptedAudio || !endedAudio) {
            console.warn('Audio elements not found in DOM');
            // Создаём элементы, если их нет
            createAudioElements();
        }
        
        // Загружаем звуки
        const promises = [];
        if (ringtoneAudio) {
            ringtoneAudio.load();
            promises.push(new Promise(resolve => {
                ringtoneAudio.addEventListener('canplaythrough', resolve, { once: true });
            }));
        }
        if (acceptedAudio) {
            acceptedAudio.load();
        }
        if (endedAudio) {
            endedAudio.load();
        }
        
        Promise.all(promises).then(resolve).catch(resolve);
    });
}

function createAudioElements() {
    ringtoneAudio = new Audio('sounds/ringtone.mp3');
    ringtoneAudio.loop = true;
    ringtoneAudio.id = 'ringtone';
    
    acceptedAudio = new Audio('sounds/call-accepted.mp3');
    acceptedAudio.id = 'call-accepted';
    
    endedAudio = new Audio('sounds/call-ended.mp3');
    endedAudio.id = 'call-ended';
    
    document.body.appendChild(ringtoneAudio);
    document.body.appendChild(acceptedAudio);
    document.body.appendChild(endedAudio);
}

// Воспроизведение звука с обработкой ошибок
function playSound(audio, fallback = true) {
    if (!audio) return false;
    
    // Сбрасываем на начало
    audio.currentTime = 0;
    
    // Пытаемся воспроизвести
    const playPromise = audio.play();
    
    if (playPromise !== undefined) {
        playPromise.catch(error => {
            console.warn('Audio playback failed:', error);
            if (fallback) {
                // Fallback - просто вибрация на мобильных
                if (navigator.vibrate) {
                    navigator.vibrate(200);
                }
            }
        });
        return true;
    }
    return false;
}

// Проверка таблицы calls
async function checkCallsTable() {
    try {
        const { error } = await supabaseClient
            .from('calls')
            .select('id')
            .limit(1);
        if (error && error.code === 'PGRST116') {
            callsTableExists = false;
            console.warn('Таблица "calls" не найдена. Функция звонков будет недоступна.');
        } else {
            callsTableExists = true;
        }
    } catch (err) {
        callsTableExists = false;
        console.warn('Не удалось проверить таблицу calls, звонки отключены.', err);
    }
}

// Очистка старых звонков
async function cleanupOldCalls() {
    if (!callsTableExists) return;
    try {
        const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        await supabaseClient
            .from('calls')
            .delete()
            .lt('created_at', fiveMinutesAgo);
    } catch (err) {
        console.error('Error cleaning up old calls:', err);
    }
}

// ICE серверы
function getIceServers() {
    return {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' }
        ]
    };
}

// Начало звонка
async function startCall() {
    if (!callsTableExists) {
        await checkCallsTable();
        if (!callsTableExists) {
            alert('Функция звонков недоступна.');
            return;
        }
    }
    if (!currentChat || currentChat.is_public || currentChat.isFavorite) return;
    
    const otherUserName = currentChat.name.split('_').find(name => name !== currentUser.name);
    const otherUser = window.allUsers?.find(u => u.username === otherUserName);
    if (!otherUser) {
        alert('Не удалось определить собеседника');
        return;
    }
    const receiverId = otherUser.id;
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        
        peerConnection = new RTCPeerConnection(getIceServers());
        
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        const callId = generateUUID();
        const timestamp = Date.now();
        
        peerConnection.onicecandidate = (event) => {
            if (event.candidate && window.ably) {
                const userChannel = window.ably.channels.get(`user-${receiverId}`);
                userChannel.publish('ice-candidate', {
                    callId,
                    candidate: event.candidate,
                    senderId: currentUser.id,
                    timestamp: Date.now()
                });
            }
        };
        
        peerConnection.ontrack = (event) => {
            console.log('Received remote track');
            const remoteStream = event.streams[0];
            const audioElement = document.createElement('audio');
            audioElement.srcObject = remoteStream;
            audioElement.autoplay = true;
            audioElement.controls = false;
            audioElement.style.display = 'none';
            document.body.appendChild(audioElement);
            
            audioElement.play().catch(e => console.warn('Auto-play failed:', e));
            
            document.getElementById('callStatus').textContent = 'В разговоре';
            if (!callTimerInterval) {
                startCallTimer();
            }
        };
        
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        const callRecord = {
            caller_id: currentUser.id,
            receiver_id: receiverId,
            status: 'calling',
            created_at: new Date().toISOString()
        };
        
        const { data, error } = await supabaseClient
            .from('calls')
            .insert([callRecord])
            .select();
        
        if (error) throw error;
        
        const dbCallId = data[0].id;
        
        currentCall = {
            id: callId,
            dbId: dbCallId,
            receiverId,
            callerId: currentUser.id,
            callerName: currentUser.name,
            callerAvatar: currentUser.avatar,
            timestamp
        };
        
        if (window.ably) {
            const userChannel = window.ably.channels.get(`user-${receiverId}`);
            userChannel.publish('offer', {
                callId,
                dbCallId,
                offer,
                callerId: currentUser.id,
                callerName: currentUser.name,
                callerAvatar: currentUser.avatar,
                timestamp
            });
        }
        
        showOutgoingCallModal();
        
    } catch (err) {
        console.error('Error starting call:', err);
        alert('Не удалось начать звонок: ' + (err.message || 'проверьте консоль'));
    }
}

// Обработчик входящего звонка (вызывается из realtime.js)
function handleIncomingCall(data) {
    const { offer, callerId, callerName, callerAvatar, callId, dbCallId, timestamp } = data;
    
    currentCall = {
        id: callId,
        dbId: dbCallId,
        callerId,
        callerName,
        callerAvatar,
        offer,
        timestamp
    };
    
    // Создаём peer connection
    peerConnection = new RTCPeerConnection(getIceServers());
    
    peerConnection.onicecandidate = (event) => {
        if (event.candidate && window.ably) {
            const userChannel = window.ably.channels.get(`user-${callerId}`);
            userChannel.publish('ice-candidate', {
                callId,
                candidate: event.candidate,
                senderId: currentUser.id,
                timestamp: Date.now()
            });
        }
    };
    
    peerConnection.ontrack = (event) => {
        console.log('Received remote track (incoming)');
        const remoteStream = event.streams[0];
        const audioElement = document.createElement('audio');
        audioElement.srcObject = remoteStream;
        audioElement.autoplay = true;
        audioElement.controls = false;
        audioElement.style.display = 'none';
        document.body.appendChild(audioElement);
        
        audioElement.play().catch(e => console.warn('Auto-play failed:', e));
        
        document.getElementById('callStatus').textContent = 'В разговоре';
        if (!callTimerInterval) {
            startCallTimer();
        }
    };
    
    showIncomingCallModal(callerName, callerAvatar, timestamp);
    
    // Воспроизводим звук звонка
    if (!currentUser.dnd) {
        playSound(ringtoneAudio);
    }
}

// Обработчик ответа на звонок
function handleCallAnswer(data) {
    const { answer, callId } = data;
    if (!currentCall || currentCall.id !== callId) return;
    
    try {
        peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        document.getElementById('callStatus').textContent = 'В разговоре';
        startCallTimer();
        
        // Останавливаем рингтон
        if (ringtoneAudio) {
            ringtoneAudio.pause();
            ringtoneAudio.currentTime = 0;
        }
        
        // Воспроизводим звук принятия
        playSound(acceptedAudio);
        
    } catch (err) {
        console.error('Error setting remote description:', err);
    }
}

// Обработчик ICE candidate
function handleIceCandidate(data) {
    const { candidate, callId } = data;
    if (!currentCall || currentCall.id !== callId) return;
    
    peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(err => {
        console.error('Error adding ICE candidate:', err);
    });
}

// Обработчик завершения звонка
function handleCallEnd(data) {
    const { callId } = data;
    if (!currentCall || currentCall.id !== callId) return;
    
    endCall();
}

// Модальные окна звонка
function showIncomingCallModal(callerName, callerAvatar, timestamp) {
    if (Date.now() - timestamp > 10000) {
        console.log('Ignoring old call', timestamp);
        return;
    }
    
    const callModal = document.getElementById('callModal');
    if (!callModal) return;
    
    document.getElementById('callStatus').textContent = 'Входящий звонок...';
    document.getElementById('callTimer').textContent = '';
    document.getElementById('callerName').textContent = callerName;
    document.getElementById('callAvatar').textContent = callerAvatar || '👤';
    document.getElementById('incomingCallControls').style.display = 'flex';
    document.getElementById('outgoingCallControls').style.display = 'none';
    
    callModal.classList.add('active');
}

function showOutgoingCallModal() {
    const callModal = document.getElementById('callModal');
    if (!callModal) return;
    
    document.getElementById('callStatus').textContent = 'Соединение...';
    document.getElementById('callTimer').textContent = '';
    document.getElementById('callerName').textContent = currentChat ? 
        (currentChat.name.split('_').find(n => n !== currentUser.name) || currentChat.name) : '';
    document.getElementById('callAvatar').textContent = currentChat?.avatar || '👤';
    document.getElementById('incomingCallControls').style.display = 'none';
    document.getElementById('outgoingCallControls').style.display = 'flex';
    
    document.getElementById('endCallBtn').onclick = endCall;
    document.getElementById('muteCallBtn').onclick = toggleMute;
    document.getElementById('muteCallBtn').classList.remove('muted');
    
    callModal.classList.add('active');
}

// Таймер звонка
function startCallTimer() {
    if (callTimerInterval) clearInterval(callTimerInterval);
    callStartTime = Date.now();
    callTimerInterval = setInterval(() => {
        const elapsed = Date.now() - callStartTime;
        if (elapsed >= CALL_DURATION_LIMIT) {
            alert('Длительность звонка превысила 30 минут. Звонок завершён.');
            endCall();
            return;
        }
        document.getElementById('callTimer').textContent = formatCallTime(elapsed);
    }, 1000);
}

function formatCallTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Ответ на звонок
async function answerCall() {
    if (!currentCall || !peerConnection) return;
    
    if (Date.now() - currentCall.timestamp > 10000) {
        alert('Звонок устарел');
        endCall();
        return;
    }
    
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStream.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStream);
        });
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(currentCall.offer));
        
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        if (currentCall.dbId) {
            await supabaseClient
                .from('calls')
                .update({ status: 'active' })
                .eq('id', currentCall.dbId);
        }
        
        if (window.ably) {
            const userChannel = window.ably.channels.get(`user-${currentCall.callerId}`);
            userChannel.publish('answer', {
                callId: currentCall.id,
                answer,
                timestamp: Date.now()
            });
        }
        
        document.getElementById('incomingCallControls').style.display = 'none';
        document.getElementById('outgoingCallControls').style.display = 'flex';
        document.getElementById('muteCallBtn').onclick = toggleMute;
        document.getElementById('muteCallBtn').classList.remove('muted');
        document.getElementById('callStatus').textContent = 'В разговоре';
        startCallTimer();
        
        // Останавливаем рингтон
        if (ringtoneAudio) {
            ringtoneAudio.pause();
            ringtoneAudio.currentTime = 0;
        }
        
        // Воспроизводим звук принятия
        playSound(acceptedAudio);
        
    } catch (err) {
        console.error('Error answering call:', err);
        alert('Не удалось ответить на звонок');
    }
}

// Отклонение звонка
async function rejectCall() {
    if (currentCall && window.ably) {
        const userChannel = window.ably.channels.get(`user-${currentCall.callerId}`);
        userChannel.publish('end', {
            callId: currentCall.id,
            timestamp: Date.now()
        });
        
        if (currentCall.dbId) {
            await supabaseClient
                .from('calls')
                .update({ status: 'ended' })
                .eq('id', currentCall.dbId);
        }
    }
    
    endCall();
}

// Завершение звонка
function endCall() {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    
    if (callTimerInterval) {
        clearInterval(callTimerInterval);
        callTimerInterval = null;
    }
    callStartTime = null;
    
    const callModal = document.getElementById('callModal');
    if (callModal) {
        callModal.classList.remove('active');
    }
    
    // Останавливаем все звуки
    if (ringtoneAudio) {
        ringtoneAudio.pause();
        ringtoneAudio.currentTime = 0;
    }
    
    // Воспроизводим звук завершения
    playSound(endedAudio);
    
    currentCall = null;
}

// Переключение mute
function toggleMute() {
    if (!localStream) return;
    
    const audioTracks = localStream.getAudioTracks();
    if (audioTracks.length === 0) return;
    
    const enabled = !audioTracks[0].enabled;
    audioTracks.forEach(track => {
        track.enabled = enabled;
    });
    
    callMuted = !enabled;
    
    const muteBtn = document.getElementById('muteCallBtn');
    const incomingMuteBtn = document.getElementById('incomingMuteBtn');
    
    [muteBtn, incomingMuteBtn].forEach(btn => {
        if (btn) {
            if (callMuted) {
                btn.textContent = '🔴';
                btn.classList.add('muted');
            } else {
                btn.textContent = '🎤';
                btn.classList.remove('muted');
            }
        }
    });
}

function generateUUID() {
    return crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// Экспорт в глобальную область
window.currentCall = currentCall;
window.localStream = localStream;
window.peerConnection = peerConnection;
window.callMuted = callMuted;
window.callsTableExists = callsTableExists;

window.initSounds = initSounds;
window.preloadSounds = initSounds; // для обратной совместимости
window.checkCallsTable = checkCallsTable;
window.cleanupOldCalls = cleanupOldCalls;
window.startCall = startCall;
window.answerCall = answerCall;
window.rejectCall = rejectCall;
window.endCall = endCall;
window.toggleMute = toggleMute;
window.listenForIncomingCalls = function() {
    // Функция-заглушка, реальная логика в realtime.js
    console.log('listenForIncomingCalls called');
};

// Экспорт обработчиков для realtime.js
window.handleIncomingCall = handleIncomingCall;
window.handleCallAnswer = handleCallAnswer;
window.handleIceCandidate = handleIceCandidate;
window.handleCallEnd = handleCallEnd;
